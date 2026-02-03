package store

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/query"
	mtypes "github.com/lugvitc/whats4linux/internal/types"
	"github.com/lugvitc/whats4linux/internal/wa"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

type Reaction struct {
	ID        int    `json:"id"`
	MessageID string `json:"message_id"`
	SenderID  string `json:"sender_id"`
	Emoji     string `json:"emoji"`
}

type ExtendedMessage struct {
	Info             types.MessageInfo
	Text             string
	ReplyToMessageID string
	Media            *wa.Media
	Edited           bool
	Forwarded        bool
	Reactions        []Reaction
}

// ChatMessage represents a chat in the chat list
type ChatMessage struct {
	JID         types.JID
	MessageText string
	MessageTime int64
	Sender      string
}

// DecodedMessage represents a message from messages.db with decoded fields
type DecodedMessage struct {
	Type             mtypes.MediaType `json:"type"`
	ReplyToMessageID string           `json:"reply_to_message_id"`
	Edited           bool             `json:"edited"`
	Forwarded        bool             `json:"forwarded"`
	Reactions        []Reaction       `json:"reactions"`
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
	StanzaID      string                 `json:"stanzaId,omitempty"`
	Participant   string                 `json:"participant,omitempty"`
	QuotedMessage *DecodedMessageContent `json:"quotedMessage,omitempty"`
}

type writeJob func(*sql.Tx) error

type MessageStore struct {
	db *sql.DB

	// [chatJID.User] = ChatMessage
	chatListMap   misc.VMap[string, ChatMessage]
	reactionCache misc.NMap[string, string, []string]

	stmtInsertMessage *sql.Stmt
	stmtInsertMedia   *sql.Stmt
	stmtUpdateMessage *sql.Stmt
	stmtUpdateMedia   *sql.Stmt

	writeCh chan writeJob
}

func NewMessageStore() (*MessageStore, error) {
	db, err := openDB()
	if err != nil {
		return nil, err
	}

	ms := &MessageStore{
		db:            db,
		chatListMap:   misc.NewVMap[string, ChatMessage](),
		reactionCache: misc.NewNMap[string, string, []string](),
		writeCh:       make(chan writeJob, 100),
	}

	go ms.runWriter()

	err = ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.CreateMessagesTable)
		if err != nil {
			return err
		}
		_, err = tx.Exec(query.CreateMessageMediaTable)
		if err != nil {
			return err
		}
		_, err = tx.Exec(query.CreateReactionsTable)
		return err
	})

	if err != nil {
		db.Close()
		return nil, err
	}

	err = ms.runSync(func(tx *sql.Tx) error {
		var err error
		ms.stmtInsertMessage, err = tx.Prepare(query.InsertMessage)
		if err != nil {
			return err
		}
		ms.stmtInsertMedia, err = tx.Prepare(query.InsertMessageMedia)
		if err != nil {
			return err
		}
		ms.stmtUpdateMessage, err = tx.Prepare(query.UpdateMessage)
		if err != nil {
			return err
		}
		ms.stmtUpdateMedia, err = tx.Prepare(query.UpdateMessageMediaByMessageID)
		return err
	})

	if err != nil {
		db.Close()
		return nil, err
	}

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

// migrateChatlist migrates chatlist entries from LID to PN when a new PN chat is detected
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

// ProcessMessageEvent processes a new message event and stores it in messages.db
func (ms *MessageStore) ProcessMessageEvent(ctx context.Context, sd store.LIDStore, msg *events.Message, parsedHTML string) string {
	ms.migrateChatlist(ctx, sd, msg.Info.Chat)

	updateCanonicalJID(ctx, sd, &msg.Info.Chat)
	updateCanonicalJID(ctx, sd, &msg.Info.Sender)

	// Handle reactions
	if msg.Message.GetReactionMessage() != nil {
		reactionMsg := msg.Message.GetReactionMessage()
		targetID := reactionMsg.GetKey().GetID()
		reaction := reactionMsg.GetText()
		senderJID := msg.Info.Sender.String()
		err := ms.AddReactionToMessage(targetID, reaction, senderJID)
		if err != nil {
			log.Println("Failed to add reaction:", err)
			return ""
		}
		return targetID
	}

	// Handle message edits
	if protoMsg := msg.Message.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
		targetID := protoMsg.GetKey().GetID()
		newContent := protoMsg.GetEditedMessage()
		if targetID == "" || newContent == nil {
			return ""
		}

		err := ms.UpdateMessageContent(targetID, newContent, parsedHTML)
		if err != nil {
			log.Println("Failed to update edited message:", err)
			return ""
		}
		return targetID
	}

	chat := msg.Info.Chat.User

	// Update chatListMap with the new latest message
	var messageText string
	if parsedHTML != "" {
		messageText = parsedHTML
	} else {
		messageText = ExtractMessageText(msg.Message)
	}
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

	err := ms.InsertMessage(&msg.Info, msg.Message, parsedHTML)
	if err != nil {
		log.Println("Failed to insert message:", err)
		return ""
	}
	return msg.Info.ID
}

// InsertMessage inserts a new message into messages.db
func (ms *MessageStore) InsertMessage(info *types.MessageInfo, msg *waE2E.Message, parsedHTML string) error {
	var (
		text, fileName, replyToMessageID string
		forwarded                        = false
		emc                              wa.ExtendedMediaContent
		mediaType                        mtypes.MediaType
		width, height                    int
	)

	text, fileName, replyToMessageID, forwarded, emc, mediaType, width, height = extractMessageContent(msg)

	if parsedHTML != "" {
		text = parsedHTML
	}

	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Stmt(ms.stmtInsertMessage).Exec(
			info.ID,
			info.Chat.String(),
			info.Sender.String(),
			info.Timestamp.Unix(),
			info.IsFromMe,
			text,
			emc != nil,
			replyToMessageID,
			false,
			forwarded,
		)
		if err != nil {
			return err
		}
		// no media to process
		if emc == nil {
			return nil
		}
		_, err = tx.Stmt(ms.stmtInsertMedia).Exec(
			info.ID,
			mediaType,
			emc.GetURL(),
			emc.GetMimetype(),
			emc.GetDirectPath(),
			emc.GetMediaKey(),
			emc.GetFileSHA256(),
			emc.GetFileEncSHA256(),
			width, height,
			fileName,
		)
		return err
	})
}

// UpdateMessageContent updates an existing message's content
func (ms *MessageStore) UpdateMessageContent(messageID string, content *waE2E.Message, parsedHTML string) error {

	var (
		text, fileName string
		emc            wa.ExtendedMediaContent
		mediaType      mtypes.MediaType
		width, height  int
	)

	text, fileName, _, _, emc, mediaType, width, height = extractMessageContent(content)

	if text == "" {
		return nil
	}

	if parsedHTML != "" {
		text = parsedHTML
	}

	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Stmt(ms.stmtUpdateMessage).Exec(
			text,
			messageID,
		)
		if err != nil {
			return err
		}
		// no media to process
		if emc == nil {
			return nil
		}

		_, err = tx.Stmt(ms.stmtUpdateMedia).Exec(
			mediaType,
			emc.GetURL(),
			emc.GetMimetype(),
			emc.GetDirectPath(),
			emc.GetMediaKey(),
			emc.GetFileSHA256(),
			emc.GetFileEncSHA256(),
			width, height,
			fileName,
			messageID,
		)
		return err
	})
}

// GetMessageWithRaw returns a message with its raw protobuf content for media download
func (ms *MessageStore) GetMessageWithMedia(chatJID string, messageID string) (*ExtendedMessage, error) {
	var (
		sender    string
		timestamp int64
		isFromMe  bool
		text      sql.NullString
		hasMedia  bool
		replyTo   sql.NullString
		edited    bool
		forwarded bool
	)

	err := ms.db.QueryRow(query.SelectMessageByChatAndID, chatJID, messageID).Scan(
		&sender,
		&timestamp,
		&isFromMe,
		&text,
		&hasMedia,
		&replyTo,
		&edited,
		&forwarded,
	)

	if err != nil {
		log.Println("GetMessageWithMedia error:", err)
		return nil, err
	}

	chatParsed, _ := types.ParseJID(chatJID)
	senderParsed, _ := types.ParseJID(sender)

	var media *wa.Media

	if hasMedia {
		var (
			mediaType     int
			url           sql.NullString
			mimetype      sql.NullString
			directPath    sql.NullString
			fileName      sql.NullString
			mediaKey      []byte
			fileSHA256    []byte
			fileEncSHA256 []byte
			width, height int
		)
		err = ms.db.QueryRow(query.SelectMessageMediaByMessageID, messageID).Scan(
			&mediaType,
			&url,
			&mimetype,
			&directPath,
			&mediaKey,
			&fileSHA256,
			&fileEncSHA256,
			&width,
			&height,
			&fileName,
		)
		if err != nil {
			log.Println("GetMessageWithMedia media query error:", err)
			return nil, err
		}
		media = wa.NewMedia(
			directPath.String,
			mediaKey, fileSHA256, fileEncSHA256,
			url.String,
			mimetype.String,
			width, height,
			mtypes.MediaType(mediaType),
		)
	}

	return &ExtendedMessage{
		Info: types.MessageInfo{
			ID:        messageID,
			Timestamp: time.Unix(timestamp, 0),
			MessageSource: types.MessageSource{
				Chat:     chatParsed,
				Sender:   senderParsed,
				IsFromMe: isFromMe,
			},
		},
		Text:             text.String,
		ReplyToMessageID: replyTo.String,
		Media:            media,
		Edited:           edited,
		Forwarded:        forwarded,
	}, nil
}

// GetMessageWithRaw returns a message with its raw protobuf content for media download
func (ms *MessageStore) GetMessageWithMediaByID(messageID string) (*ExtendedMessage, error) {
	var (
		chat      string
		sender    string
		timestamp int64
		isFromMe  bool
		text      sql.NullString
		hasMedia  bool
		replyTo   sql.NullString
		edited    bool
		forwarded bool
	)

	err := ms.db.QueryRow(query.SelectMessageByID, messageID).Scan(
		&chat,
		&sender,
		&timestamp,
		&isFromMe,
		&text,
		&hasMedia,
		&replyTo,
		&edited,
		&forwarded,
	)

	if err != nil {
		return nil, err
	}

	chatParsed, _ := types.ParseJID(chat)
	senderParsed, _ := types.ParseJID(sender)

	var media *wa.Media

	if hasMedia {
		var (
			mediaType     int
			url           sql.NullString
			mimetype      sql.NullString
			directPath    sql.NullString
			mediaKey      []byte
			fileSHA256    []byte
			fileEncSHA256 []byte
			width, height int
		)
		err = ms.db.QueryRow(query.SelectMessageMediaByMessageID, messageID).Scan(
			&mediaType,
			&url,
			&mimetype,
			&directPath,
			&mediaKey,
			&fileSHA256,
			&fileEncSHA256,
			&width,
			&height,
		)
		if err != nil {
			return nil, err
		}
		media = wa.NewMedia(
			directPath.String,
			mediaKey, fileSHA256, fileEncSHA256,
			url.String,
			mimetype.String,
			width, height,
			mtypes.MediaType(mediaType),
		)
	}

	return &ExtendedMessage{
		Info: types.MessageInfo{
			ID:        messageID,
			Timestamp: time.Unix(timestamp, 0),
			MessageSource: types.MessageSource{
				Chat:     chatParsed,
				Sender:   senderParsed,
				IsFromMe: isFromMe,
			},
		},
		Text:             text.String,
		ReplyToMessageID: replyTo.String,
		Media:            media,
		Edited:           edited,
		Forwarded:        forwarded,
	}, nil
}

// GetChatList returns the chat list from messages.db
func (ms *MessageStore) GetChatList() []ChatMessage {
	rows, err := ms.db.Query(query.SelectDecodedChatList)
	if err != nil {
		log.Println("Failed to query chat list:", err)
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
			msgType   sql.NullInt32
			text      sql.NullString
			replyTo   sql.NullString
			fileName  sql.NullString
			edited    bool
			forwarded bool
		)

		if err := rows.Scan(
			&messageID,
			&chatJID,
			&senderJID,
			&timestamp,
			&isFromMe,
			&text,
			&replyTo,
			&edited,
			&forwarded,
			&msgType,
			&fileName,
		); err != nil {
			log.Println("Failed to scan chat list row:", err)
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

		chatMsg := ChatMessage{
			JID:         jid,
			MessageText: messageText,
			MessageTime: timestamp,
			Sender:      senderJID,
		}

		// Cache per-chat entry
		ms.chatListMap.Set(jid.User, chatMsg)
		chatList = append(chatList, chatMsg)
	}
	return chatList
}

// GetReactionsByMessageID returns all reactions for a message
func (ms *MessageStore) GetReactionsByMessageID(messageID string) ([]Reaction, error) {
	underlying, mu := ms.reactionCache.GetMapWithMutex()
	mu.RLock()
	cached, ok := underlying[messageID]
	mu.RUnlock()
	if ok {
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
		err := rows.Scan(&reaction.ID, &reaction.MessageID, &reaction.SenderID, &reaction.Emoji)
		if err != nil {
			return nil, err
		}
		reactions = append(reactions, reaction)
		cacheMap[reaction.Emoji] = append(cacheMap[reaction.Emoji], reaction.SenderID)
	}

	underlying, mu = ms.reactionCache.GetMapWithMutex()
	mu.Lock()
	underlying[messageID] = cacheMap
	mu.Unlock()
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
		underlying, mu := ms.reactionCache.GetMapWithMutex()
		mu.Lock()
		if inner, ok := underlying[targetID]; ok {
			for emoji, senders := range inner {
				newSenders := make([]string, 0, len(senders))
				for _, s := range senders {
					if s != senderJID {
						newSenders = append(newSenders, s)
					}
				}
				if len(newSenders) == 0 {
					delete(inner, emoji)
				} else {
					inner[emoji] = newSenders
				}
			}
			if len(inner) == 0 {
				delete(underlying, targetID)
			}
		}
		mu.Unlock()
		return nil
	}

	err := ms.runSync(func(tx *sql.Tx) error {
		// Delete any existing reaction from this sender for this message
		_, err := tx.Exec(query.DeleteReactionsByMessageIDAndSenderID, targetID, senderJID)
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
	underlying, mu := ms.reactionCache.GetMapWithMutex()
	mu.Lock()
	inner := underlying[targetID]
	if inner == nil {
		inner = make(map[string][]string)
		underlying[targetID] = inner
	}
	// Remove from all
	for emoji, senders := range inner {
		newSenders := make([]string, 0, len(senders))
		for _, s := range senders {
			if s != senderJID {
				newSenders = append(newSenders, s)
			}
		}
		if len(newSenders) == 0 {
			delete(inner, emoji)
		} else {
			inner[emoji] = newSenders
		}
	}
	// Add to new emoji
	inner[reaction] = append(inner[reaction], senderJID)
	mu.Unlock()
	return nil
}

// extractMessageContent extracts text, reply info, and media from a WhatsApp message
func extractMessageContent(msg *waE2E.Message) (text, fileName, replyToMessageID string, forwarded bool, emc wa.ExtendedMediaContent, mediaType mtypes.MediaType, width, height int) {
	switch {
	case msg.GetConversation() != "":
		text = msg.GetConversation()
	case msg.GetExtendedTextMessage() != nil:
		contextInfo := msg.GetExtendedTextMessage().GetContextInfo()
		text = msg.GetExtendedTextMessage().GetText()
		replyToMessageID = contextInfo.GetStanzaID()
		forwarded = contextInfo.GetIsForwarded()
	}

	switch {
	case msg.GetImageMessage() != nil:
		emc = msg.GetImageMessage()
		text = msg.GetImageMessage().GetCaption()
		width = int(msg.GetImageMessage().GetWidth())
		height = int(msg.GetImageMessage().GetHeight())
		mediaType = mtypes.MediaTypeImage
		if contextInfo := msg.GetImageMessage().GetContextInfo(); contextInfo != nil {
			replyToMessageID = contextInfo.GetStanzaID()
			forwarded = contextInfo.GetIsForwarded()
		}
	case msg.GetVideoMessage() != nil:
		emc = msg.GetVideoMessage()
		text = msg.GetVideoMessage().GetCaption()
		mediaType = mtypes.MediaTypeVideo
		if contextInfo := msg.GetVideoMessage().GetContextInfo(); contextInfo != nil {
			replyToMessageID = contextInfo.GetStanzaID()
			forwarded = contextInfo.GetIsForwarded()
		}
	case msg.GetDocumentMessage() != nil:
		emc = msg.GetDocumentMessage()
		text = msg.GetDocumentMessage().GetCaption()
		fileName = msg.GetDocumentMessage().GetFileName()
		mediaType = mtypes.MediaTypeDocument
		if contextInfo := msg.GetDocumentMessage().GetContextInfo(); contextInfo != nil {
			replyToMessageID = contextInfo.GetStanzaID()
			forwarded = contextInfo.GetIsForwarded()
		}
	case msg.GetAudioMessage() != nil:
		emc = msg.GetAudioMessage()
		mediaType = mtypes.MediaTypeAudio
		if contextInfo := msg.GetAudioMessage().GetContextInfo(); contextInfo != nil {
			replyToMessageID = contextInfo.GetStanzaID()
			forwarded = contextInfo.GetIsForwarded()
		}
	case msg.GetStickerMessage() != nil:
		emc = msg.GetStickerMessage()
		mediaType = mtypes.MediaTypeSticker
		width = int(msg.GetStickerMessage().GetWidth())
		height = int(msg.GetStickerMessage().GetHeight())
		if contextInfo := msg.GetStickerMessage().GetContextInfo(); contextInfo != nil {
			replyToMessageID = contextInfo.GetStanzaID()
			forwarded = contextInfo.GetIsForwarded()
		}
	default:
		if text == "" {
			return
		}
	}

	return
}

// GetDecodedMessagesPaged returns a page of decoded messages from messages.db
func (ms *MessageStore) GetDecodedMessagesPaged(chatJID string, beforeTimestamp int64, limit int) ([]DecodedMessage, error) {
	var rows *sql.Rows
	var err error

	if beforeTimestamp == 0 {
		rows, err = ms.db.Query(query.SelectLatestMessagesByChat, chatJID, limit)
	} else {
		rows, err = ms.db.Query(query.SelectMessagesByChatBeforeTimestamp, chatJID, beforeTimestamp, limit)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []DecodedMessage

	for rows.Next() {
		var (
			msgId             string
			chatJid           string
			senderJid         string
			timestamp         int64
			isFromMe          bool
			text              sql.NullString
			replyTo           sql.NullString
			edited, forwarded bool
			msgType           sql.NullInt32
			fileName          sql.NullString
		)

		err := rows.Scan(
			&msgId,
			&chatJid,
			&senderJid,
			&timestamp,
			&isFromMe,
			&text,
			&replyTo,
			&edited,
			&forwarded,
			&msgType,
			&fileName,
		)
		if err != nil {
			log.Println("Failed to scan decoded message:", err)
			continue
		}

		msg := DecodedMessage{
			Type:             mtypes.MediaType(msgType.Int32),
			ReplyToMessageID: replyTo.String,
			Edited:           edited,
			Forwarded:        forwarded,
			Info: DecodedMessageInfo{
				ID:        msgId,
				Timestamp: time.Unix(timestamp, 0).Format(time.RFC3339),
				IsFromMe:  isFromMe,
				PushName:  "",
				Sender:    senderJid,
				Chat:      chatJid,
			},
		}

		// Load reactions for this message
		reactions, err := ms.GetReactionsByMessageID(msgId)
		if err == nil {
			msg.Reactions = reactions
		}

		// Populate Content for frontend rendering
		msg.Content = ms.buildDecodedContent(chatJID, text.String, msg.ReplyToMessageID, fileName.String, msg.Type)

		messages = append(messages, msg)
	}

	return messages, nil
}

// buildDecodedContent creates a DecodedMessageContent from DecodedMessage fields
func (ms *MessageStore) buildDecodedContent(
	chatJID, text, replyToMessageId, fileName string,
	mediaType mtypes.MediaType,
) *DecodedMessageContent {
	content := &DecodedMessageContent{}

	// Build context info if there's a reply
	var contextInfo *ContextInfo
	if replyToMessageId != "" {
		// Fetch the quoted message, but don't recursively load its content to avoid race conditions

		quotedMsg, err := ms.GetDecodedMessage(chatJID, replyToMessageId)
		if err == nil && quotedMsg != nil {
			contextInfo = &ContextInfo{
				StanzaID:      replyToMessageId,
				Participant:   quotedMsg.Info.Sender,
				QuotedMessage: quotedMsg.Content,
			}
		} else {
			contextInfo = &ContextInfo{
				StanzaID: replyToMessageId,
			}
		}
	}

	// Based on message type, populate the appropriate content field
	switch mtypes.MediaType(mediaType) {
	case mtypes.MediaTypeNone:
		if contextInfo != nil {
			content.ExtendedTextMessage = &ExtendedTextContent{
				Text:        text,
				ContextInfo: contextInfo,
			}
		} else {
			content.Conversation = text
		}
	case mtypes.MediaTypeImage:
		content.ImageMessage = &MediaMessageContent{
			Caption:     text,
			ContextInfo: contextInfo,
		}
	case mtypes.MediaTypeVideo:
		content.VideoMessage = &MediaMessageContent{
			Caption:     text,
			ContextInfo: contextInfo,
		}
	case mtypes.MediaTypeAudio:
		content.AudioMessage = &MediaMessageContent{
			ContextInfo: contextInfo,
		}
	case mtypes.MediaTypeDocument:
		content.DocumentMessage = &DocumentMessageContent{
			FileName:    fileName,
			Caption:     text,
			ContextInfo: contextInfo,
		}
	case mtypes.MediaTypeSticker:
		content.StickerMessage = &MediaMessageContent{
			ContextInfo: contextInfo,
		}
	default:
		content.Conversation = text
	}

	return content
}

// GetDecodedMessage returns a single decoded message from messages.db
func (ms *MessageStore) GetDecodedMessage(chatJID string, messageID string) (*DecodedMessage, error) {
	var (
		sender            string
		timestamp         int64
		isFromMe          bool
		replyTo           sql.NullString
		edited, forwarded bool
		text              sql.NullString
		msgType           sql.NullInt32
		fileName          sql.NullString
	)

	// Use runSync to ensure read consistency with pending writes
	err := ms.runSync(func(tx *sql.Tx) error {
		err := tx.QueryRow(query.SelectDecodedMessageByChatAndID, chatJID, messageID).Scan(
			&sender,
			&timestamp,
			&isFromMe,
			&text,
			&replyTo,
			&edited,
			&forwarded,
			&msgType,
			&fileName,
		)

		if err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	msg := DecodedMessage{
		Type:             mtypes.MediaType(msgType.Int32),
		Edited:           edited,
		Forwarded:        forwarded,
		ReplyToMessageID: replyTo.String,
		Info: DecodedMessageInfo{
			ID:        messageID,
			Timestamp: time.Unix(timestamp, 0).Format(time.RFC3339),
			IsFromMe:  isFromMe,
			PushName:  "",
			Sender:    sender,
			Chat:      chatJID,
		},
	}

	// Load reactions outside transaction to avoid nested runSync
	reactions, err := ms.GetReactionsByMessageID(messageID)
	if err == nil {
		msg.Reactions = reactions
	}

	// Populate Content for frontend rendering
	msg.Content = ms.buildDecodedContent(chatJID, text.String, msg.ReplyToMessageID, fileName.String, msg.Type)

	return &msg, nil
}

// GetDecodedChatList returns the chat list from messages.db with the latest message for each chat
func (ms *MessageStore) GetDecodedChatList() ([]DecodedMessage, error) {
	rows, err := ms.db.Query(query.SelectDecodedChatList)
	if err != nil {
		log.Println("Failed to query decoded chat list:", err)
		return nil, err
	}
	defer rows.Close()

	var messages []DecodedMessage

	for rows.Next() {
		var (
			messageId         string
			chat              string
			sender            string
			timestamp         int64
			isFromMe          bool
			text              sql.NullString
			replyTo           sql.NullString
			edited, forwarded bool
			msgType           sql.NullInt32
			fileName          sql.NullString
		)

		err := rows.Scan(
			&messageId,
			&chat,
			&sender,
			&timestamp,
			&isFromMe,
			&text,
			&replyTo,
			&edited,
			&forwarded,
			&msgType,
			&fileName,
		)
		if err != nil {
			log.Println("Failed to scan decoded message for chat list:", err)
			continue
		}

		msg := DecodedMessage{
			Type:             mtypes.MediaType(msgType.Int32),
			Edited:           edited,
			Forwarded:        forwarded,
			ReplyToMessageID: replyTo.String,
			Info: DecodedMessageInfo{
				ID:        messageId,
				Timestamp: time.Unix(timestamp, 0).Format(time.RFC3339),
				IsFromMe:  isFromMe,
				PushName:  "",
				Sender:    sender,
				Chat:      chat,
			},
		}

		// Populate Content for frontend rendering
		msg.Content = ms.buildDecodedContent(chat, text.String, msg.ReplyToMessageID, fileName.String, msg.Type)

		messages = append(messages, msg)
	}

	return messages, nil
}
