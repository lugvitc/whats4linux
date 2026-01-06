package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/gob"
	"encoding/json"
	"log"

	query "github.com/lugvitc/whats4linux/internal/db"
	"github.com/lugvitc/whats4linux/internal/misc"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type Reaction struct {
	ID        int    `json:"id"`
	MessageID string `json:"message_id"`
	SenderID  string `json:"sender_id"`
	Emoji     string `json:"emoji"`
}

type Message struct {
	Info      types.MessageInfo
	Content   *waE2E.Message
	Edited    bool
	Reactions []Reaction
}

const MaxMessageCacheSize = 50

type writeJob func(tx *sql.Tx) error

type MessageStore struct {
	db *sql.DB

	// [chatJID.User] = ChatMessage
	chatListMap misc.VMap[string, ChatMessage]
	mCache      misc.VMap[string, uint8]

	stmtInsert *sql.Stmt
	stmtUpdate *sql.Stmt

	writeCh chan writeJob
}

func (ms *MessageStore) runWriter() {
	for job := range ms.writeCh {
		tx, err := ms.db.Begin()
		if err != nil {
			continue
		}

		if err := job(tx); err != nil {
			tx.Rollback()
			continue
		}

		tx.Commit()
	}
}

func (ms *MessageStore) runSync(job writeJob) error {
	done := make(chan error, 1)

	ms.writeCh <- func(tx *sql.Tx) error {
		err := job(tx)
		done <- err
		return err
	}

	return <-done
}

// ExtractMessageText extracts a text representation from a WhatsApp message
func ExtractMessageText(msg *waE2E.Message) string {
	if msg.GetConversation() != "" {
		return msg.GetConversation()
	} else if msg.GetExtendedTextMessage() != nil {
		return msg.GetExtendedTextMessage().GetText()
	} else {
		switch {
		case msg.GetImageMessage() != nil:
			return "image"
		case msg.GetVideoMessage() != nil:
			return "video"
		case msg.GetAudioMessage() != nil:
			return "audio"
		case msg.GetDocumentMessage() != nil:
			return "document"
		case msg.GetStickerMessage() != nil:
			return "sticker"
		default:
			return "message"
		}
	}
}

func NewMessageStore() (*MessageStore, error) {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("mdb"))
	if err != nil {
		return nil, err
	}

	pragmas := []string{
		`PRAGMA journal_mode=WAL;`,
		`PRAGMA synchronous=NORMAL;`,
		`PRAGMA busy_timeout=5000;`,
		`PRAGMA foreign_keys=ON;`,
	}

	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			return nil, err
		}
	}

	ms := &MessageStore{
		db:          db,
		writeCh:     make(chan writeJob, 100),
		mCache:      misc.NewVMap[string, uint8](),
		chatListMap: misc.NewVMap[string, ChatMessage](),
	}

	go ms.runWriter()

	err = ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.CreateSchema)
		return err
	})

	if err != nil {
		return nil, err
	}

	err = ms.runSync(func(tx *sql.Tx) error {
		var err error
		ms.stmtInsert, err = tx.Prepare(query.InsertMessage)
		if err != nil {
			return err
		}
		ms.stmtUpdate, err = tx.Prepare(query.UpdateMessage)
		return err
	})

	if err != nil {
		return nil, err
	}

	return ms, nil
}

func updateCanonicalJID(ctx context.Context, js store.LIDStore, jid *types.JID) (changed bool) {
	if jid == nil {
		return
	}
	if jid.ActualAgent() != types.LIDDomain {
		return
	}
	canonicalJID, err := js.GetPNForLID(ctx, *jid)
	if err != nil {
		log.Println("Failed to get PN for LID:", err)
		return
	}
	changed = true
	*jid = canonicalJID
	return
}

func (ms *MessageStore) migrateChatlist(ctx context.Context, sd store.LIDStore, chat types.JID) {
	if chat.ActualAgent() == types.LIDDomain {
		// not a jid, skip
		return
	}
	if _, ok := ms.chatListMap.Get(chat.User); ok {
		// not a new jid, skip
		return
	}
	// new chat in chatlist
	// check if a corresponding lid exists
	lid, err := sd.GetLIDForPN(ctx, chat)
	if err != nil {
		return
	}
	if lid.User == "" {
		return
	}
	// check if lid has a chatlist entry (means there are messages for this lid chat)
	if _, ok := ms.chatListMap.Get(lid.User); !ok {
		// no messages for this lid chat, nothing to migrate
		return
	}
	// migrate all messages from this lid to pn
	// hack: we won't update the msginfo, just update chat marker in messages for now
	// complete the migrate on next restart when chat != msginfo.chat
	ms.writeCh <- func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.UpdateMessagesChat,
			chat.String(),
			lid.String(),
		)
		return err
	}
	log.Printf("Migrated messages.chat marker from LID %s to PN %s\n", lid.String(), chat.String())

	// delete lid chatlist entry from cache
	ms.chatListMap.Delete(lid.User)
}

func (ms *MessageStore) ProcessMessageEvent(ctx context.Context, sd store.LIDStore, msg *events.Message) {
	ms.migrateChatlist(ctx, sd, msg.Info.Chat)

	updateCanonicalJID(ctx, sd, &msg.Info.Chat)
	updateCanonicalJID(ctx, sd, &msg.Info.Sender)

	if protoMsg := msg.Message.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
		targetID := protoMsg.GetKey().GetID()
		newContent := protoMsg.GetEditedMessage()
		if targetID == "" || newContent == nil {
			return
		}

		originalMsg := ms.GetMessage(msg.Info.Chat, targetID)
		if originalMsg == nil {
			originalMsg = ms.GetMessageByID(targetID)
		}

		if originalMsg == nil {
			UpdateMessage(&Message{Info: types.MessageInfo{ID: targetID}, Content: newContent, Edited: true})
			return
		}

		originalMsg.Content = newContent
		originalMsg.Edited = true
		ms.updateMessageInDB(originalMsg)
		UpdateMessage(originalMsg)
		return
	}

	chat := msg.Info.Chat.User

	m := Message{
		Info:    msg.Info,
		Content: msg.Message,
		Edited:  false,
	}

	// Update chatListMap with the new latest message
	messageText := ExtractMessageText(m.Content)
	sender := msg.Info.PushName
	if sender == "" && msg.Info.Sender.User != "" {
		sender = msg.Info.Sender.User
	}

	if msg.Info.IsFromMe {
		sender = "You"
	}

	chatMsg := ChatMessage{
		JID:         msg.Info.Chat,
		MessageText: messageText,
		MessageTime: msg.Info.Timestamp.Unix(),
		Sender:      sender,
	}
	ms.chatListMap.Set(chat, chatMsg)

	if _, exists := ms.mCache.Get(msg.Info.ID); exists {
		ms.updateMessageInDB(&m)
		UpdateMessage(&m)
		return
	}
	ms.mCache.Set(msg.Info.ID, 1)
	ms.insertMessageToDB(&m)
	InsertMessage(&m)
}

func getMessageArrayFromRows(rows *sql.Rows) []Message {
	var (
		messages  []Message
		minf      []byte
		raw       []byte
		timestamp int64
	)

	for rows.Next() {
		minf = minf[:0]
		raw = raw[:0]

		if err := rows.Scan(&minf, &raw, &timestamp); err != nil {
			continue
		}

		var messageInfo types.MessageInfo
		if err := gobDecode(minf, &messageInfo); err != nil {
			continue
		}

		var waMsg *waE2E.Message
		waMsg, err := unmarshalMessageContent(raw)

		if err != nil {
			continue
		}

		messages = append(messages, Message{
			Info:    messageInfo,
			Content: waMsg,
			Edited:  false,
		})
	}

	return messages
}

func buildMessageFromRawData(minf []byte, raw []byte) *Message {
	var messageInfo types.MessageInfo
	if err := gobDecode(minf, &messageInfo); err != nil {
		return nil
	}

	waMsg, err := unmarshalMessageContent(raw)
	if err != nil {
		return nil
	}

	return &Message{
		Info:    messageInfo,
		Content: waMsg,
		Edited:  false,
	}
}

// GetMessagesPaged returns a page of messages for a chat
// beforeTimestamp: only return messages before this timestamp (0 = latest)
// limit: max number of messages to return
// Returns messages in chronological order (oldest first within the page)
// todo: optimize with caching
func (ms *MessageStore) GetMessagesPaged(jid types.JID, beforeTimestamp int64, limit int) []Message {
	var rows *sql.Rows
	var err error

	if beforeTimestamp == 0 {
		// Get latest messages using the optimized query
		rows, err = ms.db.Query(query.SelectLatestMessagesByChat, jid.String(), limit)
	} else {
		// Get messages before timestamp using the optimized query
		rows, err = ms.db.Query(query.SelectMessagesByChatBeforeTimestamp, jid.String(), beforeTimestamp, limit)
	}

	if err != nil {
		return []Message{}
	}

	defer rows.Close()

	return getMessageArrayFromRows(rows)
}

func (ms *MessageStore) GetMessage(chatJID types.JID, messageID string) *Message {
	row := ms.db.QueryRow(query.SelectMessageByChatAndID, chatJID.String(), messageID)
	var (
		minf []byte
		raw  []byte
	)

	if err := row.Scan(&minf, &raw); err != nil {
		return nil
	}

	return buildMessageFromRawData(minf, raw)
}

// GetMessageByID searches for a message by ID across all chats
func (ms *MessageStore) GetMessageByID(messageID string) *Message {

	// Query database
	var chat, msgID string
	var ts int64
	var minf, raw []byte

	err := ms.db.QueryRow(query.SelectMessageByID, messageID).Scan(&chat, &msgID, &ts, &minf, &raw)
	if err != nil {
		return nil
	}

	var messageInfo types.MessageInfo
	if err := gobDecode(minf, &messageInfo); err != nil {
		return nil
	}

	waMsg, err := unmarshalMessageContent(raw)
	if err != nil {
		return nil
	}

	return &Message{Info: messageInfo, Content: waMsg, Edited: false}
}

type ChatMessage struct {
	JID         types.JID
	MessageText string
	MessageTime int64
	Sender      string
}

func (ms *MessageStore) GetChatList() []ChatMessage {
	rows, err := ms.db.Query(query.SelectChatList)
	if err != nil {
		return []ChatMessage{}
	}
	defer rows.Close()

	var chatList []ChatMessage

	var (
		chat string
		ts   int64
		minf []byte
		raw  []byte
	)

	for rows.Next() {
		minf = minf[:0]
		raw = raw[:0]

		if err := rows.Scan(&chat, &ts, &minf, &raw); err != nil {
			continue
		}

		chatJID, err := types.ParseJID(chat)
		if err != nil {
			continue
		}

		// Check per-chat cache first
		if cachedChat, ok := ms.chatListMap.Get(chatJID.User); ok {
			chatList = append(chatList, cachedChat)
			continue
		}

		var messageInfo types.MessageInfo
		if err := gobDecode(minf, &messageInfo); err != nil {
			continue
		}

		var waMsg *waE2E.Message
		waMsg, err = unmarshalMessageContent(raw)
		if err != nil {
			continue
		}

		var messageText string
		messageText = ExtractMessageText(waMsg)

		chatMsg := ChatMessage{
			JID:         chatJID,
			MessageText: messageText,
			MessageTime: ts,
		}

		// Cache per-chat entry
		ms.chatListMap.Set(chatJID.User, chatMsg)
		chatList = append(chatList, chatMsg)
	}

	return chatList
}

func (ms *MessageStore) insertMessageToDB(msg *Message) error {
	msgInfo, err := gobEncode(msg.Info)
	if err != nil {
		return err
	}

	rawMessage, err := marshalMessageContent(msg.Content)
	if err != nil {
		return err
	}

	ms.writeCh <- func(tx *sql.Tx) error {
		_, err := tx.Stmt(ms.stmtInsert).Exec(
			msg.Info.Chat.String(),
			msg.Info.ID,
			msg.Info.Timestamp.Unix(),
			msgInfo,
			rawMessage,
		)
		return err
	}
	return nil
}

func (ms *MessageStore) updateMessageInDB(msg *Message) error {
	msgInfo, err := gobEncode(msg.Info)
	if err != nil {
		return err
	}

	rawMessage, err := marshalMessageContent(msg.Content)
	if err != nil {
		return err
	}

	ms.writeCh <- func(tx *sql.Tx) error {
		_, err := tx.Stmt(ms.stmtUpdate).Exec(
			msgInfo,
			rawMessage,
			msg.Info.ID,
		)
		return err
	}
	return nil
}

func (ms *MessageStore) MigrateLIDToPN(ctx context.Context, sd store.LIDStore) error {
	log.Println("Starting LID to PN migration for messages...")

	return ms.runSync(func(tx *sql.Tx) error {
		log.Println("Fetching all messages for migration...")
		defer log.Println("Migration task completed.")
		rows, err := tx.Query(query.SelectAllMessagesInfo)
		if err != nil {
			return err
		}
		defer rows.Close()

		stmtUpdate, err := tx.Prepare(query.UpdateMessageInfo)
		if err != nil {
			return err
		}
		defer stmtUpdate.Close()

		var (
			minf   []byte
			chat   string
			oC, oS string
		)

		for rows.Next() {
			minf = minf[:0]

			if err := rows.Scan(&chat, &minf); err != nil {
				continue
			}

			var messageInfo types.MessageInfo
			if err := gobDecode(minf, &messageInfo); err != nil {
				log.Println("Failed to decode message info during LID to PN migration:", err)
				continue
			}

			chatDiff := messageInfo.Chat.String() != chat // chat marker was updated, migration pending

			chatJid, _ := types.ParseJID(chat)
			messageInfo.Chat = chatJid

			oC = messageInfo.Chat.String()
			oS = messageInfo.Sender.String()

			cc := updateCanonicalJID(ctx, sd, &messageInfo.Chat)
			sc := updateCanonicalJID(ctx, sd, &messageInfo.Sender)

			if !cc && !sc && !chatDiff {
				continue
			}

			msgInfo, err := gobEncode(messageInfo)
			if err != nil {
				log.Println("Failed to encode message info during LID to PN migration:", err)
				continue
			}

			_, err = stmtUpdate.Exec(
				messageInfo.Chat.String(),
				msgInfo,
				messageInfo.ID,
			)

			if err != nil {
				log.Println("Failed to update message during LID to PN migration:", err)
				continue
			}

			if cc {
				log.Printf("Migrated message %s chat from LID %s to PN %s\n",
					messageInfo.ID, oC, messageInfo.Chat.String())
			}
			if sc {
				log.Printf("Migrated message %s sender from LID %s to PN %s\n",
					messageInfo.ID, oS, messageInfo.Sender.String())
			}
		}
		return nil
	})
}

func MigrateLIDToPNForMessagesDB(ctx context.Context, sd store.LIDStore) error {
	log.Println("Starting LID to PN migration for messages.db...")

	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("messages.db"))
	if err != nil {
		return err
	}
	defer db.Close()

	log.Println("Fetching all messages for migration...")
	defer log.Println("Migration task completed.")

	rows, err := db.Query(query.SelectAllMessagesJIDs)
	if err != nil {
		return err
	}
	defer rows.Close()

	stmtUpdate, err := db.Prepare(query.UpdateMessageJIDs)
	if err != nil {
		return err
	}
	defer stmtUpdate.Close()

	var (
		messageID    string
		chatJIDStr   string
		senderJIDStr string
		oC, oS       string
	)

	for rows.Next() {
		if err := rows.Scan(&messageID, &chatJIDStr, &senderJIDStr); err != nil {
			continue
		}

		chatJID, err := types.ParseJID(chatJIDStr)
		if err != nil {
			log.Println("Failed to parse chat JID:", err)
			continue
		}

		senderJID, err := types.ParseJID(senderJIDStr)
		if err != nil {
			log.Println("Failed to parse sender JID:", err)
			continue
		}

		oC = chatJID.String()
		oS = senderJID.String()

		cc := updateCanonicalJID(ctx, sd, &chatJID)
		sc := updateCanonicalJID(ctx, sd, &senderJID)

		if !cc && !sc {
			continue
		}

		_, err = stmtUpdate.Exec(
			chatJID.String(),
			senderJID.String(),
			messageID,
		)

		if err != nil {
			log.Println("Failed to update message during LID to PN migration:", err)
			continue
		}

		if cc {
			log.Printf("Migrated message %s chat from LID %s to PN %s\n",
				messageID, oC, chatJID.String())
		}
		if sc {
			log.Printf("Migrated message %s sender from LID %s to PN %s\n",
				messageID, oS, senderJID.String())
		}
	}
	return nil
}

func marshalMessageContent(msg *waE2E.Message) ([]byte, error) {
	return proto.Marshal(msg)
}

func unmarshalMessageContent(data []byte) (*waE2E.Message, error) {
	var msg waE2E.Message
	if err := proto.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

func gobEncode(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := gob.NewEncoder(&buf)
	err := enc.Encode(v)
	return buf.Bytes(), err
}

func gobDecode(data []byte, v any) error {
	buf := bytes.NewBuffer(data)
	dec := gob.NewDecoder(buf)
	return dec.Decode(v)
}

func init() {
	gob.Register(&types.MessageInfo{})
}

func InsertMessage(msg *Message) error {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("messages.db"))
	if err != nil {
		return err
	}
	defer db.Close()

	if _, err := db.Exec(query.CreateMessagesTable); err != nil {
		return err
	}

	// Handle reaction messages differently - update the target message instead of creating a new one
	if msg.Content.GetReactionMessage() != nil {
		reactionMsg := msg.Content.GetReactionMessage()
		targetID := reactionMsg.GetKey().GetID()
		reaction := reactionMsg.GetText()
		senderJID := msg.Info.Sender.String()

		return AddReactionToMessage(targetID, reaction, senderJID)
	}

	var msgType query.MessageType = query.MessageTypeText
	var mediaType query.MediaType
	var text string
	var mentions string

	// Extract mentions if it's an extended text message
	var replyToMessageID string
	if msg.Content.GetExtendedTextMessage() != nil && msg.Content.GetExtendedTextMessage().GetContextInfo() != nil {
		if mentioned := msg.Content.GetExtendedTextMessage().GetContextInfo().GetMentionedJID(); len(mentioned) > 0 {
			mentionsBytes, _ := json.Marshal(mentioned)
			mentions = string(mentionsBytes)
		}
		replyToMessageID = msg.Content.GetExtendedTextMessage().GetContextInfo().GetStanzaID()
	}

	if msg.Content.GetConversation() != "" {
		text = msg.Content.GetConversation()
	} else if msg.Content.GetExtendedTextMessage() != nil {
		text = msg.Content.GetExtendedTextMessage().GetText()
	} else {
		switch {
		case msg.Content.GetImageMessage() != nil:
			msgType = query.MessageTypeImage
			mediaType = query.MediaTypeImage
			text = "image"
		case msg.Content.GetVideoMessage() != nil:
			msgType = query.MessageTypeVideo
			mediaType = query.MediaTypeVideo
			text = "video"
		case msg.Content.GetAudioMessage() != nil:
			msgType = query.MessageTypeAudio
			mediaType = query.MediaTypeAudio
			text = "audio"
		case msg.Content.GetDocumentMessage() != nil:
			msgType = query.MessageTypeDocument
			mediaType = query.MediaTypeDocument
			text = "document"
		case msg.Content.GetStickerMessage() != nil:
			msgType = query.MessageTypeSticker
			mediaType = query.MediaTypeSticker
			text = "sticker"
		default:
			text = "message"
		}
	}

	_, err = db.Exec(query.InsertDecodedMessage,
		msg.Info.ID,
		msg.Info.Chat.String(),
		msg.Info.Sender.String(),
		msg.Info.Timestamp.Unix(),
		msg.Info.IsFromMe,
		msgType,
		text,
		mediaType,
		replyToMessageID,
		mentions,
		msg.Edited,
	)

	return err
}

func UpdateMessage(msg *Message) error {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("messages.db"))
	if err != nil {
		return err
	}
	defer db.Close()

	var msgType query.MessageType = query.MessageTypeText
	var text string

	if msg.Content.GetConversation() != "" {
		text = msg.Content.GetConversation()
	} else if msg.Content.GetExtendedTextMessage() != nil {
		text = msg.Content.GetExtendedTextMessage().GetText()
	} else {
		switch {
		case msg.Content.GetImageMessage() != nil:
			msgType = query.MessageTypeImage
			text = "image"
		case msg.Content.GetVideoMessage() != nil:
			msgType = query.MessageTypeVideo
			text = "video"
		case msg.Content.GetAudioMessage() != nil:
			msgType = query.MessageTypeAudio
			text = "audio"
		case msg.Content.GetDocumentMessage() != nil:
			msgType = query.MessageTypeDocument
			text = "document"
		case msg.Content.GetStickerMessage() != nil:
			msgType = query.MessageTypeSticker
			text = "sticker"
		default:
			text = "message"
		}
	}

	_, err = db.Exec(query.UpdateDecodedMessage,
		text,
		msgType,
		msg.Info.ID,
	)

	return err
}

func GetMessage(messageID string) (*Message, error) {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("messages.db"))
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var (
		id               string
		chatJID          string
		senderJID        string
		timestamp        int64
		isFromMe         bool
		msgType          uint8
		text             string
		mediaType        string
		replyToMessageID string
		mentions         string
		edited           bool
	)

	err = db.QueryRow(query.SelectDecodedMessageByID, messageID).Scan(
		&id,
		&chatJID,
		&senderJID,
		&timestamp,
		&isFromMe,
		&msgType,
		&text,
		&mediaType,
		&replyToMessageID,
		&mentions,
		&edited,
	)

	if err != nil {
		return nil, err
	}

	// Load reactions for this message
	reactions, err := GetReactionsByMessageID(messageID)
	if err != nil {
		return nil, err
	}

	chat, _ := types.ParseJID(chatJID)
	sender, _ := types.ParseJID(senderJID)

	msg := &Message{
		Info: types.MessageInfo{
			ID:        id,
			Timestamp: time.Unix(timestamp, 0),
			MessageSource: types.MessageSource{
				Chat:     chat,
				Sender:   sender,
				IsFromMe: isFromMe,
			},
		},
		Content:   &waE2E.Message{},
		Edited:    edited,
		Reactions: reactions,
	}

	return msg, nil
}

func GetReactionsByMessageID(messageID string) ([]Reaction, error) {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("messages.db"))
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query(query.SelectReactionsByMessageID, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reactions []Reaction
	for rows.Next() {
		var reaction Reaction
		err := rows.Scan(&reaction.ID, &reaction.MessageID, &reaction.SenderID, &reaction.Emoji)
		if err != nil {
			return nil, err
		}
		reactions = append(reactions, reaction)
	}

	return reactions, nil
}

func AddReactionToMessage(targetID, reaction, senderJID string) error {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("messages.db"))
	if err != nil {
		return err
	}
	defer db.Close()

	// If reaction is empty, remove all reactions from this sender for this message
	if reaction == "" {
		_, err = db.Exec(`DELETE FROM reactions WHERE message_id = ? AND sender_id = ?`, targetID, senderJID)
		return err
	}

	// Start a transaction
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Delete any existing reaction from this sender for this message
	_, err = tx.Exec(`DELETE FROM reactions WHERE message_id = ? AND sender_id = ?`, targetID, senderJID)
	if err != nil {
		return err
	}

	// Insert the new reaction
	_, err = tx.Exec(query.InsertReaction, targetID, senderJID, reaction)
	if err != nil {
		return err
	}

	// Commit the transaction
	return tx.Commit()
}
