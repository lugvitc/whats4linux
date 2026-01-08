package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/gob"
	"log"
	"time"

	query "github.com/lugvitc/whats4linux/internal/db"
	"github.com/lugvitc/whats4linux/internal/misc"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func gobDecode(data []byte, v interface{}) error {
	return gob.NewDecoder(bytes.NewReader(data)).Decode(v)
}

func gobEncode(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	err := gob.NewEncoder(&buf).Encode(v)
	return buf.Bytes(), err
}

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

// ChatMessage represents a chat in the chat list
type ChatMessage struct {
	JID         types.JID
	MessageText string
	MessageTime int64
	Sender      string
}

type writeJob func(*sql.Tx) error

type MessageStore struct {
	db *sql.DB

	// [chatJID.User] = ChatMessage
	chatListMap misc.VMap[string, ChatMessage]
	mCache      misc.VMap[string, uint8]
	reactionCache misc.VMap[string, map[string][]string]

	stmtInsert *sql.Stmt
	stmtUpdate *sql.Stmt

	writeCh chan writeJob
}

func NewMessageStore() (*MessageStore, error) {
	db, err := openDB()
	if err != nil {
		return nil, err
	}

	if _, err := db.Exec(query.CreateMessagesTable); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(query.CreateReactionsTable); err != nil {
		db.Close()
		return nil, err
	}

	stmtInsert, err := db.Prepare(query.InsertDecodedMessage)
	if err != nil {
		db.Close()
		return nil, err
	}

	stmtUpdate, err := db.Prepare(query.UpdateDecodedMessage)
	if err != nil {
		stmtInsert.Close()
		db.Close()
		return nil, err
	}

	ms := &MessageStore{
		db:          db,
		chatListMap: misc.NewVMap[string, ChatMessage](),
		mCache:      misc.NewVMap[string, uint8](),
		reactionCache: misc.NewVMap[string, map[string][]string](),
		stmtInsert:  stmtInsert,
		stmtUpdate:  stmtUpdate,
		writeCh:     make(chan writeJob, 100),
	}

	go ms.runWriter()

	return ms, nil
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

// openDB opens a connection to messages.db
func openDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("messages.db"))
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
			db.Close()
			return nil, err
		}
	}

	return db, nil
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

func (ms *MessageStore) MigrateLIDToPN(ctx context.Context, sd store.LIDStore) error {
	log.Println("Starting LID to PN migration for messages...")

	return ms.runSync(func(tx *sql.Tx) error {
		log.Println("Fetching all messages for migration...")
		defer log.Println("Migration task completed.")
		rows, err := tx.Query(query.SelectAllMessagesJIDs)
		if err != nil {
			return err
		}
		defer rows.Close()

		stmtUpdate, err := tx.Prepare(query.UpdateMessageJIDs)
		if err != nil {
			return err
		}
		defer stmtUpdate.Close()

		var (
			msgID  string
			chat   string
			sender string
			oC, oS string
		)

		for rows.Next() {
			if err := rows.Scan(&msgID, &chat, &sender); err != nil {
				continue
			}

			chatJid, _ := types.ParseJID(chat)
			senderJid, _ := types.ParseJID(sender)

			oC = chatJid.String()
			oS = senderJid.String()

			cc := updateCanonicalJID(ctx, sd, &chatJid)
			sc := updateCanonicalJID(ctx, sd, &senderJid)

			if !cc && !sc {
				continue
			}

			if cc {
				log.Printf("Migrated message %s chat from LID %s to PN %s\n",
					msgID, oC, chatJid.String())
			}
			if sc {
				log.Printf("Migrated message %s sender from LID %s to PN %s\n",
					msgID, oS, senderJid.String())
			}

			_, err = stmtUpdate.Exec(
				chatJid.String(),
				senderJid.String(),
				msgID,
			)

			if err != nil {
				log.Println("Failed to update message during LID to PN migration:", err)
				continue
			}
		}
		return nil
	})
}

// ProcessMessageEvent processes a new message event and stores it in messages.db
func (ms *MessageStore) ProcessMessageEvent(ctx context.Context, sd store.LIDStore, msg *events.Message) {
	updateCanonicalJID(ctx, sd, &msg.Info.Chat)
	updateCanonicalJID(ctx, sd, &msg.Info.Sender)

	// Handle message edits
	if protoMsg := msg.Message.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
		targetID := protoMsg.GetKey().GetID()
		newContent := protoMsg.GetEditedMessage()
		if targetID == "" || newContent == nil {
			return
		}

		err := ms.UpdateMessageContent(targetID, newContent)
		if err != nil {
			log.Println("Failed to update edited message:", err)
		}
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

	// Check if message already processed
	if _, exists := ms.mCache.Get(msg.Info.ID); exists {
		// Update existing message
		err := ms.UpdateMessageContent(msg.Info.ID, m.Content)
		if err != nil {
			log.Println("Failed to update message:", err)
		}
		return
	}

	ms.mCache.Set(msg.Info.ID, 1)
	err := ms.InsertMessage(&m)
	if err != nil {
		log.Println("Failed to insert message:", err)
	}
}

// InsertMessage inserts a new message into messages.db
func (ms *MessageStore) InsertMessage(msg *Message) error {
	// Handle reaction messages differently
	if msg.Content.GetReactionMessage() != nil {
		reactionMsg := msg.Content.GetReactionMessage()
		targetID := reactionMsg.GetKey().GetID()
		reaction := reactionMsg.GetText()
		senderJID := msg.Info.Sender.String()

		return ms.AddReactionToMessage(targetID, reaction, senderJID)
	}

	var msgType query.MessageType = query.MessageTypeText
	var mediaType query.MediaType
	var text string

	// Extract mentions if it's an extended text message
	var replyToMessageID string
	if msg.Content.GetExtendedTextMessage() != nil && msg.Content.GetExtendedTextMessage().GetContextInfo() != nil {
		replyToMessageID = msg.Content.GetExtendedTextMessage().GetContextInfo().GetStanzaID()
	}

	// Serialize raw message for media types

	if msg.Content.GetConversation() != "" {
		text = msg.Content.GetConversation()
	} else if msg.Content.GetExtendedTextMessage() != nil {
		text = msg.Content.GetExtendedTextMessage().GetText()
	} else {
		switch {
		case msg.Content.GetImageMessage() != nil:
			msgType = query.MessageTypeImage
			mediaType = query.MediaTypeImage
			text = msg.Content.GetImageMessage().GetCaption()
			if text == "" {
				text = "image"
			}
		case msg.Content.GetVideoMessage() != nil:
			msgType = query.MessageTypeVideo
			mediaType = query.MediaTypeVideo
			text = msg.Content.GetVideoMessage().GetCaption()
			if text == "" {
				text = "video"
			}
		case msg.Content.GetAudioMessage() != nil:
			msgType = query.MessageTypeAudio
			mediaType = query.MediaTypeAudio
			text = "audio"
		case msg.Content.GetDocumentMessage() != nil:
			msgType = query.MessageTypeDocument
			mediaType = query.MediaTypeDocument
			text = msg.Content.GetDocumentMessage().GetFileName()
			if text == "" {
				text = "document"
			}
		case msg.Content.GetStickerMessage() != nil:
			msgType = query.MessageTypeSticker
			mediaType = query.MediaTypeSticker
			text = "sticker"
		default:
			// Log unsupported message type with detailed information
			log.Printf("Skipping unsupported message type for message ID %s in chat %s", msg.Info.ID, msg.Info.Chat.String())
			log.Printf("Message content details:")
			switch {
			case msg.Content.GetConversation() != "":
				log.Printf("  - Has conversation: %s", msg.Content.GetConversation())
			case msg.Content.GetExtendedTextMessage() != nil:
				log.Printf("  - Has extended text: %s", msg.Content.GetExtendedTextMessage().GetText())
			case msg.Content.GetImageMessage() != nil:
				log.Printf("  - Has image message")
			case msg.Content.GetVideoMessage() != nil:
				log.Printf("  - Has video message")
			case msg.Content.GetAudioMessage() != nil:
				log.Printf("  - Has audio message")
			case msg.Content.GetDocumentMessage() != nil:
				log.Printf("  - Has document message")
			case msg.Content.GetStickerMessage() != nil:
				log.Printf("  - Has sticker message")
			case msg.Content.GetContactMessage() != nil:
				log.Printf("  - Has contact message")
			case msg.Content.GetLocationMessage() != nil:
				log.Printf("  - Has location message")
			case msg.Content.GetLiveLocationMessage() != nil:
				log.Printf("  - Has live location message")
			case msg.Content.GetPollCreationMessage() != nil:
				log.Printf("  - Has poll creation message")
			case msg.Content.GetPollUpdateMessage() != nil:
				log.Printf("  - Has poll update message")
			case msg.Content.GetProtocolMessage() != nil:
				log.Printf("  - Has protocol message (type: %v)", msg.Content.GetProtocolMessage().GetType())
			case msg.Content.GetReactionMessage() != nil:
				log.Printf("  - Has reaction message")
			case msg.Content.GetSenderKeyDistributionMessage() != nil:
				log.Printf("  - Has sender key distribution message")
			}
			log.Printf("Full message content: %+v", msg.Content)
			return nil
		}
	}

	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Stmt(ms.stmtInsert).Exec(
			msg.Info.ID,
			msg.Info.Chat.String(),
			msg.Info.Sender.String(),
			msg.Info.Timestamp.Unix(),
			msg.Info.IsFromMe,
			msgType,
			text,
			mediaType,
			replyToMessageID,
			msg.Edited,
		)
		if err != nil {
			return err
		}

		return nil
	})
}

// UpdateMessageContent updates an existing message's content
func (ms *MessageStore) UpdateMessageContent(messageID string, content *waE2E.Message) error {
	var msgType query.MessageType = query.MessageTypeText
	var text string

	if content.GetConversation() != "" {
		text = content.GetConversation()
	} else if content.GetExtendedTextMessage() != nil {
		text = content.GetExtendedTextMessage().GetText()
	} else {
		switch {
		case content.GetImageMessage() != nil:
			msgType = query.MessageTypeImage
			text = content.GetImageMessage().GetCaption()
			if text == "" {
				text = "image"
			}
		case content.GetVideoMessage() != nil:
			msgType = query.MessageTypeVideo
			text = content.GetVideoMessage().GetCaption()
			if text == "" {
				text = "video"
			}
		case content.GetAudioMessage() != nil:
			msgType = query.MessageTypeAudio
			text = "audio"
		case content.GetDocumentMessage() != nil:
			msgType = query.MessageTypeDocument
			text = content.GetDocumentMessage().GetFileName()
			if text == "" {
				text = "document"
			}
		case content.GetStickerMessage() != nil:
			msgType = query.MessageTypeSticker
			text = "sticker"
		default:
			text = "message"
		}
	}

	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Stmt(ms.stmtUpdate).Exec(
			text,
			msgType,
			messageID,
		)
		return err
	})
}

// GetMessageWithRaw returns a message with its raw protobuf content for media download
func (ms *MessageStore) GetMessageWithRaw(chatJID string, messageID string) (*Message, error) {
	var (
		id        string
		chat      string
		sender    string
		timestamp int64
		isFromMe  bool
		msgType   int
		text      sql.NullString
		mediaType sql.NullInt64
		replyTo   sql.NullString
		edited    bool
	)

	err := ms.db.QueryRow(query.SelectMessageWithRawByChatAndID, chatJID, messageID).Scan(
		&id,
		&chat,
		&sender,
		&timestamp,
		&isFromMe,
		&msgType,
		&text,
		&mediaType,
		&replyTo,
		&edited,
	)

	if err != nil {
		return nil, err
	}

	chatParsed, _ := types.ParseJID(chat)
	senderParsed, _ := types.ParseJID(sender)

	msg := &Message{
		Info: types.MessageInfo{
			ID:        id,
			Timestamp: time.Unix(timestamp, 0),
			MessageSource: types.MessageSource{
				Chat:     chatParsed,
				Sender:   senderParsed,
				IsFromMe: isFromMe,
			},
		},
		Edited: edited,
	}

	// Note: Raw message content is no longer stored, so Content will be nil
	// Media downloads will not work without raw message content

	return msg, nil
}

// GetMessageByIDWithRaw returns a message by ID with its raw protobuf content
func (ms *MessageStore) GetMessageByIDWithRaw(messageID string) (*Message, error) {
	var (
		id        string
		chat      string
		sender    string
		timestamp int64
		isFromMe  bool
		msgType   int
		text      sql.NullString
		mediaType sql.NullInt64
		replyTo   sql.NullString
		edited    bool
	)

	err := ms.db.QueryRow(query.SelectMessageWithRawByID, messageID).Scan(
		&id,
		&chat,
		&sender,
		&timestamp,
		&isFromMe,
		&msgType,
		&text,
		&mediaType,
		&replyTo,
		&edited,
	)

	if err != nil {
		return nil, err
	}

	chatParsed, _ := types.ParseJID(chat)
	senderParsed, _ := types.ParseJID(sender)

	msg := &Message{
		Info: types.MessageInfo{
			ID:        id,
			Timestamp: time.Unix(timestamp, 0),
			MessageSource: types.MessageSource{
				Chat:     chatParsed,
				Sender:   senderParsed,
				IsFromMe: isFromMe,
			},
		},
		Edited: edited,
	}

	// Note: Raw message content is no longer stored, so Content will be nil
	// Media downloads will not work without raw message content

	return msg, nil
}

// GetChatList returns the chat list from messages.db
func (ms *MessageStore) GetChatList() []ChatMessage {
	rows, err := ms.db.Query(query.SelectDecodedChatList)
	if err != nil {
		return []ChatMessage{}
	}
	defer rows.Close()

	var chatList []ChatMessage

	for rows.Next() {
		var (
			messageID string
			chatJID   string
			senderJID string
			timestamp int64
			isFromMe  bool
			msgType   int
			text      sql.NullString
			mediaType sql.NullInt64
			replyTo   sql.NullString
			edited    bool
		)

		if err := rows.Scan(
			&messageID,
			&chatJID,
			&senderJID,
			&timestamp,
			&isFromMe,
			&msgType,
			&text,
			&mediaType,
			&replyTo,
			&edited,
		); err != nil {
			continue
		}

		jid, err := types.ParseJID(chatJID)
		if err != nil {
			continue
		}

		// Check per-chat cache first
		if cachedChat, ok := ms.chatListMap.Get(jid.User); ok {
			chatList = append(chatList, cachedChat)
			continue
		}

		var messageText string
		if text.Valid {
			messageText = text.String
		}

		// Determine sender for display
		sender := ""
		if isFromMe {
			sender = "You"
		}

		chatMsg := ChatMessage{
			JID:         jid,
			MessageText: messageText,
			MessageTime: timestamp,
			Sender:      sender,
		}

		// Cache per-chat entry
		ms.chatListMap.Set(jid.User, chatMsg)
		chatList = append(chatList, chatMsg)
	}

	return chatList
}


// GetReactionsByMessageID returns all reactions for a message
func (ms *MessageStore) GetReactionsByMessageID(messageID string) ([]Reaction, error) {
	if cached, ok := ms.reactionCache.Get(messageID); ok {
		var reactions []Reaction
		for emoji, senders := range cached {
			for _, sender := range senders {
				reactions = append(reactions, Reaction{
					MessageID: messageID,
					SenderID:  sender,
					Emoji:     emoji,
				})
			}
		}
		return reactions, nil
	}

	rows, err := ms.db.Query(query.SelectReactionsByMessageID, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reactions []Reaction
	cacheMap := make(map[string][]string)
	for rows.Next() {
		var reaction Reaction
		err := rows.Scan(&reaction.MessageID, &reaction.SenderID, &reaction.Emoji)
		if err != nil {
			return nil, err
		}
		reactions = append(reactions, reaction)
		cacheMap[reaction.Emoji] = append(cacheMap[reaction.Emoji], reaction.SenderID)
	}

	ms.reactionCache.Set(messageID, cacheMap)
	return reactions, nil
}

// AddReactionToMessage adds or removes a reaction to/from a message
func (ms *MessageStore) AddReactionToMessage(targetID, reaction, senderJID string) error {
	// If reaction is empty, remove all reactions from this sender for this message
	if reaction == "" {
		err := ms.runSync(func(tx *sql.Tx) error {
			_, err := tx.Exec(`DELETE FROM reactions WHERE message_id = ? AND sender_id = ?`, targetID, senderJID)
			return err
		})
		if err != nil {
			return err
		}
		// Update cache: remove senderJID from all emojis for targetID
		if cached, ok := ms.reactionCache.Get(targetID); ok {
			for emoji, senders := range cached {
				newSenders := make([]string, 0, len(senders))
				for _, s := range senders {
					if s != senderJID {
						newSenders = append(newSenders, s)
					}
				}
				if len(newSenders) == 0 {
					delete(cached, emoji)
				} else {
					cached[emoji] = newSenders
				}
			}
			if len(cached) == 0 {
				ms.reactionCache.Delete(targetID)
			} else {
				ms.reactionCache.Set(targetID, cached)
			}
		}
		return nil
	}

	err := ms.runSync(func(tx *sql.Tx) error {
		// Delete any existing reaction from this sender for this message
		_, err := tx.Exec(`DELETE FROM reactions WHERE message_id = ? AND sender_id = ?`, targetID, senderJID)
		if err != nil {
			return err
		}

		// Insert the new reaction
		_, err = tx.Exec(query.InsertReaction, targetID, senderJID, reaction)
		return err
	})
	if err != nil {
		return err
	}
	// Update cache: remove sender from all emojis, then add to new emoji
	if cached, ok := ms.reactionCache.Get(targetID); ok {
		// Remove from all
		for emoji, senders := range cached {
			newSenders := make([]string, 0, len(senders))
			for _, s := range senders {
				if s != senderJID {
					newSenders = append(newSenders, s)
				}
			}
			if len(newSenders) == 0 {
				delete(cached, emoji)
			} else {
				cached[emoji] = newSenders
			}
		}
		// Add to new emoji
		cached[reaction] = append(cached[reaction], senderJID)
		ms.reactionCache.Set(targetID, cached)
	} else {
		// New map
		cacheMap := map[string][]string{reaction: {senderJID}}
		ms.reactionCache.Set(targetID, cacheMap)
	}
	return nil
}

// DecodedMessage represents a message from messages.db with decoded fields
type DecodedMessage struct {
	MessageID        string     `json:"message_id"`
	ChatJID          string     `json:"chat_jid"`
	SenderJID        string     `json:"sender_jid"`
	Timestamp        int64      `json:"timestamp"`
	IsFromMe         bool       `json:"is_from_me"`
	Type             int        `json:"type"`
	Text             string     `json:"text"`
	MediaType        int        `json:"media_type"`
	ReplyToMessageID string     `json:"reply_to_message_id"`
	Edited           bool       `json:"edited"`
	Reactions        []Reaction `json:"reactions"`
	// Info provides compatibility with frontend that expects types.MessageInfo structure
	Info DecodedMessageInfo `json:"Info"`
	// Content provides a minimal content structure for frontend rendering
	Content *DecodedMessageContent `json:"Content"`
}

// DecodedMessageInfo is a simplified MessageInfo for frontend compatibility
type DecodedMessageInfo struct {
	ID        string `json:"ID"`
	Timestamp string `json:"Timestamp"`
	IsFromMe  bool   `json:"IsFromMe"`
	PushName  string `json:"PushName"`
	Sender    string `json:"Sender"`
	Chat      string `json:"Chat"`
}

// DecodedMessageContent provides minimal content info for frontend rendering
type DecodedMessageContent struct {
	Conversation        string                  `json:"conversation,omitempty"`
	ExtendedTextMessage *ExtendedTextContent    `json:"extendedTextMessage,omitempty"`
	ImageMessage        *MediaMessageContent    `json:"imageMessage,omitempty"`
	VideoMessage        *MediaMessageContent    `json:"videoMessage,omitempty"`
	AudioMessage        *MediaMessageContent    `json:"audioMessage,omitempty"`
	DocumentMessage     *DocumentMessageContent `json:"documentMessage,omitempty"`
	StickerMessage      *MediaMessageContent    `json:"stickerMessage,omitempty"`
}

type ExtendedTextContent struct {
	Text        string       `json:"text,omitempty"`
	ContextInfo *ContextInfo `json:"contextInfo,omitempty"`
}

type MediaMessageContent struct {
	Caption     string       `json:"caption,omitempty"`
	Mimetype    string       `json:"mimetype,omitempty"`
	ContextInfo *ContextInfo `json:"contextInfo,omitempty"`
}

type DocumentMessageContent struct {
	Caption     string       `json:"caption,omitempty"`
	FileName    string       `json:"fileName,omitempty"`
	Mimetype    string       `json:"mimetype,omitempty"`
	ContextInfo *ContextInfo `json:"contextInfo,omitempty"`
}

type ContextInfo struct {
	StanzaID      string `json:"stanzaId,omitempty"`
	Participant   string `json:"participant,omitempty"`
	QuotedMessage any    `json:"quotedMessage,omitempty"`
}

// GetDecodedMessagesPaged returns a page of decoded messages from messages.db
func (ms *MessageStore) GetDecodedMessagesPaged(chatJID string, beforeTimestamp int64, limit int) ([]DecodedMessage, error) {
	var rows *sql.Rows
	var err error

	if beforeTimestamp == 0 {
		rows, err = ms.db.Query(query.SelectLatestDecodedMessagesByChat, chatJID, limit)
	} else {
		rows, err = ms.db.Query(query.SelectDecodedMessagesByChatBeforeTimestamp, chatJID, beforeTimestamp, limit)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []DecodedMessage

	for rows.Next() {
		var msg DecodedMessage
		var mediaType sql.NullInt64
		var replyTo sql.NullString
		var text sql.NullString

		err := rows.Scan(
			&msg.MessageID,
			&msg.ChatJID,
			&msg.SenderJID,
			&msg.Timestamp,
			&msg.IsFromMe,
			&msg.Type,
			&text,
			&mediaType,
			&replyTo,
			&msg.Edited,
		)
		if err != nil {
			log.Println("Failed to scan decoded message:", err)
			continue
		}

		if text.Valid {
			msg.Text = text.String
		}
		if mediaType.Valid {
			msg.MediaType = int(mediaType.Int64)
		}
		if replyTo.Valid {
			msg.ReplyToMessageID = replyTo.String
		}

		// Load reactions for this message
		reactions, err := ms.GetReactionsByMessageID(msg.MessageID)
		if err == nil {
			msg.Reactions = reactions
		}

		// Populate Info for frontend compatibility
		msg.Info = DecodedMessageInfo{
			ID:        msg.MessageID,
			Timestamp: time.Unix(msg.Timestamp, 0).Format(time.RFC3339),
			IsFromMe:  msg.IsFromMe,
			PushName:  "",
			Sender:    msg.SenderJID,
			Chat:      msg.ChatJID,
		}

		// Populate Content for frontend rendering
		msg.Content = buildDecodedContent(&msg)

		messages = append(messages, msg)
	}

	return messages, nil
}

// buildDecodedContent creates a DecodedMessageContent from DecodedMessage fields
func buildDecodedContent(msg *DecodedMessage) *DecodedMessageContent {
	content := &DecodedMessageContent{}

	// Build context info if there's a reply
	var contextInfo *ContextInfo
	if msg.ReplyToMessageID != "" {
		contextInfo = &ContextInfo{
			StanzaID: msg.ReplyToMessageID,
		}
	}

	// Based on message type, populate the appropriate content field
	switch query.MessageType(msg.Type) {
	case query.MessageTypeText:
		if contextInfo != nil {
			content.ExtendedTextMessage = &ExtendedTextContent{
				Text:        msg.Text,
				ContextInfo: contextInfo,
			}
		} else {
			content.Conversation = msg.Text
		}
	case query.MessageTypeImage:
		content.ImageMessage = &MediaMessageContent{
			Caption:     msg.Text,
			ContextInfo: contextInfo,
		}
	case query.MessageTypeVideo:
		content.VideoMessage = &MediaMessageContent{
			Caption:     msg.Text,
			ContextInfo: contextInfo,
		}
	case query.MessageTypeAudio:
		content.AudioMessage = &MediaMessageContent{
			ContextInfo: contextInfo,
		}
	case query.MessageTypeDocument:
		content.DocumentMessage = &DocumentMessageContent{
			FileName:    msg.Text,
			ContextInfo: contextInfo,
		}
	case query.MessageTypeSticker:
		content.StickerMessage = &MediaMessageContent{
			ContextInfo: contextInfo,
		}
	default:
		content.Conversation = msg.Text
	}

	return content
}

// GetDecodedMessage returns a single decoded message from messages.db
func (ms *MessageStore) GetDecodedMessage(chatJID string, messageID string) (*DecodedMessage, error) {
	var msg DecodedMessage
	var mediaType sql.NullInt64
	var replyTo sql.NullString
	var text sql.NullString

	err := ms.db.QueryRow(query.SelectDecodedMessageByChatAndID, chatJID, messageID).Scan(
		&msg.MessageID,
		&msg.ChatJID,
		&msg.SenderJID,
		&msg.Timestamp,
		&msg.IsFromMe,
		&msg.Type,
		&text,
		&mediaType,
		&replyTo,
		&msg.Edited,
	)

	if err != nil {
		return nil, err
	}

	if text.Valid {
		msg.Text = text.String
	}
	if mediaType.Valid {
		msg.MediaType = int(mediaType.Int64)
	}
	if replyTo.Valid {
		msg.ReplyToMessageID = replyTo.String
	}

	// Load reactions
	reactions, err := ms.GetReactionsByMessageID(msg.MessageID)
	if err == nil {
		msg.Reactions = reactions
	}

	// Populate Info for frontend compatibility
	msg.Info = DecodedMessageInfo{
		ID:        msg.MessageID,
		Timestamp: time.Unix(msg.Timestamp, 0).Format(time.RFC3339),
		IsFromMe:  msg.IsFromMe,
		PushName:  "",
		Sender:    msg.SenderJID,
		Chat:      msg.ChatJID,
	}

	// Populate Content for frontend rendering
	msg.Content = buildDecodedContent(&msg)

	return &msg, nil
}

// GetDecodedChatList returns the chat list from messages.db with the latest message for each chat
func (ms *MessageStore) GetDecodedChatList() ([]DecodedMessage, error) {
	rows, err := ms.db.Query(query.SelectDecodedChatList)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []DecodedMessage

	for rows.Next() {
		var msg DecodedMessage
		var mediaType sql.NullInt64
		var replyTo sql.NullString
		var text sql.NullString

		err := rows.Scan(
			&msg.MessageID,
			&msg.ChatJID,
			&msg.SenderJID,
			&msg.Timestamp,
			&msg.IsFromMe,
			&msg.Type,
			&text,
			&mediaType,
			&replyTo,
			&msg.Edited,
		)
		if err != nil {
			log.Println("Failed to scan decoded message for chat list:", err)
			continue
		}

		if text.Valid {
			msg.Text = text.String
		}
		if mediaType.Valid {
			msg.MediaType = int(mediaType.Int64)
		}
		if replyTo.Valid {
			msg.ReplyToMessageID = replyTo.String
		}

		// Populate Info for frontend compatibility
		msg.Info = DecodedMessageInfo{
			ID:        msg.MessageID,
			Timestamp: time.Unix(msg.Timestamp, 0).Format(time.RFC3339),
			IsFromMe:  msg.IsFromMe,
			PushName:  "",
			Sender:    msg.SenderJID,
			Chat:      msg.ChatJID,
		}

		// Populate Content for frontend rendering
		msg.Content = buildDecodedContent(&msg)

		messages = append(messages, msg)
	}

	return messages, nil
}
