package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"regexp"
	"strings"
	"sync"
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
	Type             mtypes.MediaType    `json:"type"`
	ReplyToMessageID string              `json:"reply_to_message_id"`
	Edited           bool                `json:"edited"`
	Forwarded        bool                `json:"forwarded"`
	Reactions        []Reaction          `json:"reactions"`
	LinkPreview      *DecodedLinkPreview `json:"link_preview,omitempty"`
	Poll             *PollInfo           `json:"poll,omitempty"`
	// Info provides compatibility with frontend that expects types.MessageInfo structure
	Info DecodedMessageInfo `json:"Info"`
	// Content provides a minimal content structure for frontend rendering
	Content *DecodedMessageContent `json:"Content"`
}

type DecodedLinkPreview struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	HasPoster   bool   `json:"has_poster"`
}

// PollInfo carries structured poll data for the frontend.
type PollInfo struct {
	Name            string     `json:"name"`
	Options         []string   `json:"options"`
	SelectableCount int        `json:"selectableCount"`
	Votes           []PollVote `json:"votes,omitempty"`
}

// PollVote represents a single voter's selections on a poll.
type PollVote struct {
	SenderJID string   `json:"sender_jid"`
	Options   []string `json:"options"`
	UpdatedAt int64    `json:"updated_at"`
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
	GifPlayback bool         `json:"gifPlayback,omitempty"`
	Width       int          `json:"width,omitempty"`
	Height      int          `json:"height,omitempty"`
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

type writeRequest struct {
	job  writeJob
	done chan error
}

type MessageStore struct {
	db *sql.DB

	// [chatJID.User] = ChatMessage
	chatListMap   misc.VMap[string, ChatMessage]
	reactionCache misc.NMap[string, string, []string]

	stmtInsertMessage *sql.Stmt
	stmtInsertMedia   *sql.Stmt
	stmtUpdateMessage *sql.Stmt
	stmtUpdateMedia   *sql.Stmt

	writeMu    sync.RWMutex
	writeCh    chan writeRequest
	writerDone chan struct{}
	closed     bool
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
		writeCh:       make(chan writeRequest, 100),
		writerDone:    make(chan struct{}),
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
		// Migrate pre-existing tables: add gif_playback / thumbnail if missing.
		// Ignore the "duplicate column name" error once the column exists.
		if _, aerr := tx.Exec(query.AddGifPlaybackColumn); aerr != nil && !strings.Contains(aerr.Error(), "duplicate column") {
			return aerr
		}
		if _, aerr := tx.Exec(query.AddThumbnailColumn); aerr != nil && !strings.Contains(aerr.Error(), "duplicate column") {
			return aerr
		}
		_, err = tx.Exec(query.CreatePinnedMessagesTable)
		if err != nil {
			return err
		}
		_, err = tx.Exec(query.CreatePinnedChatsTable)
		if err != nil {
			return err
		}
		_, err = tx.Exec(query.CreateMutedChatsTable)
		if err != nil {
			return err
		}
		_, err = tx.Exec(query.CreateArchivedChatsTable)
		if err != nil {
			return err
		}
		_, err = tx.Exec(query.CreateReactionsTable)
		if err != nil {
			return err
		}
		_, err = tx.Exec(query.CreateReadReceiptsTable)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(query.CreateLinkPreviewsTable); err != nil {
			return err
		}
		if _, err = tx.Exec(query.CreatePollsTable); err != nil {
			return err
		}
		if _, err = tx.Exec(query.CreatePollVotesTable); err != nil {
			return err
		}
		if _, err = tx.Exec(query.CreateCallHistoryTable); err != nil {
			return err
		}
		// Add poster-download key columns to pre-existing link_previews tables.
		for _, mig := range []string{
			query.AddLinkPreviewDirectPath, query.AddLinkPreviewMediaKey,
			query.AddLinkPreviewFileSHA, query.AddLinkPreviewFileEncSHA,
		} {
			if _, aerr := tx.Exec(mig); aerr != nil && !strings.Contains(aerr.Error(), "duplicate column") {
				return aerr
			}
		}
		return nil
	})

	if err != nil {
		_ = ms.Close()
		return nil, err
	}

	// These statements outlive individual write transactions, so prepare them
	// on the database rather than on a transaction (transaction statements are
	// closed on commit and would be re-prepared for every write).
	ms.stmtInsertMessage, err = db.Prepare(query.InsertMessage)
	if err == nil {
		ms.stmtInsertMedia, err = db.Prepare(query.InsertMessageMedia)
	}
	if err == nil {
		ms.stmtUpdateMessage, err = db.Prepare(query.UpdateMessage)
	}
	if err == nil {
		ms.stmtUpdateMedia, err = db.Prepare(query.UpdateMessageMediaByMessageID)
	}

	if err != nil {
		_ = ms.Close()
		return nil, err
	}

	return ms, nil
}

func (ms *MessageStore) runWriter() {
	defer close(ms.writerDone)
	for req := range ms.writeCh {
		tx, err := ms.db.BeginTx(context.Background(), nil)
		if err == nil {
			err = req.job(tx)
			if err != nil {
				if rollbackErr := tx.Rollback(); rollbackErr != nil {
					err = errors.Join(err, rollbackErr)
				}
			} else {
				err = tx.Commit()
			}
		}

		if req.done != nil {
			req.done <- err
			close(req.done)
		} else if err != nil {
			log.Println("asynchronous message-store write failed:", err)
		}
	}
}

func (ms *MessageStore) runSync(job writeJob) error {
	done := make(chan error, 1)
	if err := ms.enqueueWrite(writeRequest{job: job, done: done}); err != nil {
		return err
	}
	return <-done
}

func (ms *MessageStore) enqueueWrite(req writeRequest) error {
	ms.writeMu.RLock()
	defer ms.writeMu.RUnlock()
	if ms.closed {
		return errors.New("message store is closed")
	}
	ms.writeCh <- req
	return nil
}

// Close drains committed writes, closes prepared statements, and then closes
// the database. Callers must stop the WhatsApp event source before calling it.
func (ms *MessageStore) Close() error {
	ms.writeMu.Lock()
	if ms.closed {
		ms.writeMu.Unlock()
		return nil
	}
	ms.closed = true
	close(ms.writeCh)
	ms.writeMu.Unlock()
	<-ms.writerDone

	var closeErr error
	for _, stmt := range []*sql.Stmt{
		ms.stmtInsertMessage,
		ms.stmtInsertMedia,
		ms.stmtUpdateMessage,
		ms.stmtUpdateMedia,
	} {
		if stmt != nil {
			closeErr = errors.Join(closeErr, stmt.Close())
		}
	}
	return errors.Join(closeErr, ms.db.Close())
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

// UnwrapMessage peels off container messages (ephemeral / view-once /
// device-sent / document-with-caption) to reach the real content. whatsmeow
// does this for live messages, but not for history-sync (ParseWebMessage),
// which otherwise leaves disappearing-message content looking "unsupported".
func UnwrapMessage(m *waE2E.Message) *waE2E.Message {
	for m != nil {
		switch {
		case m.GetEphemeralMessage().GetMessage() != nil:
			m = m.GetEphemeralMessage().GetMessage()
		case m.GetViewOnceMessage().GetMessage() != nil:
			m = m.GetViewOnceMessage().GetMessage()
		case m.GetViewOnceMessageV2().GetMessage() != nil:
			m = m.GetViewOnceMessageV2().GetMessage()
		case m.GetViewOnceMessageV2Extension().GetMessage() != nil:
			m = m.GetViewOnceMessageV2Extension().GetMessage()
		case m.GetDeviceSentMessage().GetMessage() != nil:
			m = m.GetDeviceSentMessage().GetMessage()
		case m.GetDocumentWithCaptionMessage().GetMessage() != nil:
			m = m.GetDocumentWithCaptionMessage().GetMessage()
		default:
			return m
		}
	}
	return m
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
			if preview, ok := SpecialPreview(msg); ok {
				return preview
			}
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
	if err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.UpdateMessagesChat,
			chat.String(),
			lid.String(),
		)
		return err
	}); err != nil {
		log.Printf("Failed to migrate messages.chat marker from LID %s to PN %s: %v\n", lid.String(), chat.String(), err)
		return
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

	// Handle revokes: replace the target's content with a deleted marker.
	if protoMsg := msg.Message.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_REVOKE {
		targetID := protoMsg.GetKey().GetID()
		if targetID == "" {
			return ""
		}
		if err := ms.MarkMessageDeleted(targetID); err != nil {
			log.Println("Failed to mark message deleted:", err)
			return ""
		}
		return targetID
	}

	// Unwrap before skipping so that poll votes (and similar protocol
	// messages) wrapped in ephemeral/view-once containers are detected.
	msg.Message = UnwrapMessage(msg.Message)

	// Protocol noise (poll votes, keep-in-chat, remaining protocol messages)
	// must not create visible rows or bump the chat list.
	if ShouldSkipMessage(msg.Message) && msg.Message.GetPinInChatMessage() == nil {
		return ""
	}

	chat := msg.Info.Chat.User

	// Update chatListMap with the new latest message
	var messageText string
	if parsedHTML != "" {
		messageText = ChatListPreview(parsedHTML)
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
	msg = UnwrapMessage(msg)
	var (
		text, fileName, replyToMessageID string
		forwarded                        = false
		emc                              wa.ExtendedMediaContent
		mediaType                        mtypes.MediaType
		width, height                    int
	)

	var messageType mtypes.MessageType

	// todo: add a flush system on pin expiry
	switch {
	case msg.PinInChatMessage != nil && msg.PinInChatMessage.Key != nil:
		pin := msg.PinInChatMessage
		switch *pin.Type {
		case waE2E.PinInChatMessage_PIN_FOR_ALL:
			var dur uint32
			if msg.GetMessageContextInfo() != nil {
				dur = *msg.GetMessageContextInfo().MessageAddOnDurationInSecs
			}
			err := ms.runSync(func(tx *sql.Tx) error {
				_, err := tx.Exec(query.InsertPinnedMessages, pin.Key.ID, info.Chat.String(), info.Sender.String(), info.Timestamp.Unix(), dur)
				return err
			})
			if err != nil {
				return err
			}
		case waE2E.PinInChatMessage_UNPIN_FOR_ALL:
			// do not process the message further
			return ms.runSync(func(tx *sql.Tx) error {
				_, err := tx.Exec(query.DeletePinnedMessageByMessageId, pin.Key.ID)
				return err
			})
		default:
			log.Println("unknown pin type", pin.Type, "in message:", msg)
		}
		messageType = mtypes.MessageTypeMessagePinned
	default:
		messageType = mtypes.MessageTypeNormal
	}

	text, fileName, replyToMessageID, forwarded, emc, mediaType, width, height = extractMessageContent(msg)

	// gifPlayback marks a video that should loop like a GIF. GetVideoMessage is
	// nil-safe and returns false for non-video messages.
	gifPlayback := msg.GetVideoMessage().GetGifPlayback()

	// Embedded preview thumbnail (WhatsApp ships a small JPEG in the message) so
	// videos show a preview + play button in the list without downloading them.
	var thumbnail []byte
	if v := msg.GetVideoMessage(); v != nil {
		thumbnail = v.GetJPEGThumbnail()
	} else if p := msg.GetPtvMessage(); p != nil {
		thumbnail = p.GetJPEGThumbnail()
	} else if i := msg.GetImageMessage(); i != nil {
		thumbnail = i.GetJPEGThumbnail()
	}

	// Link preview (title/description/thumbnail) from a text message with a URL.
	// The poster image is usually a downloadable reference rather than embedded,
	// so keep its keys to fetch it lazily later.
	var lpURL, lpTitle, lpDesc, lpDirectPath string
	var lpThumb, lpMediaKey, lpFileSHA, lpFileEncSHA []byte
	if etm := msg.GetExtendedTextMessage(); etm != nil && (etm.GetTitle() != "" || len(etm.GetJPEGThumbnail()) > 0 || etm.GetThumbnailDirectPath() != "") {
		lpURL = etm.GetMatchedText()
		lpTitle = etm.GetTitle()
		lpDesc = etm.GetDescription()
		lpThumb = etm.GetJPEGThumbnail()
		lpDirectPath = etm.GetThumbnailDirectPath()
		lpMediaKey = etm.GetMediaKey()
		lpFileSHA = etm.GetThumbnailSHA256()
		lpFileEncSHA = etm.GetThumbnailEncSHA256()
	}
	hasPreview := lpTitle != "" || len(lpThumb) > 0 || lpDirectPath != ""

	if parsedHTML != "" {
		text = parsedHTML
	}

	// Message types with no plain-text body (polls, locations, contacts,
	// invites, events…) render as prebuilt HTML cards.
	if text == "" && emc == nil {
		if special, ok := DescribeSpecialMessage(msg); ok {
			text = special
		}
	}

	// Extract structured poll data from creation messages so the frontend
	// can render an interactive poll card instead of a static HTML card.
	var pollName string
	var pollOptionsJSON string
	var pollSelectable int
	if poll := pollFromMessage(msg); poll != nil {
		pollName = poll.GetName()
		opts := make([]string, 0, len(poll.GetOptions()))
		for _, o := range poll.GetOptions() {
			opts = append(opts, o.GetOptionName())
		}
		optsJSON, _ := json.Marshal(opts)
		pollOptionsJSON = string(optsJSON)
		pollSelectable = int(poll.GetSelectableOptionsCount())
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
			messageType,
		)
		if err != nil {
			return err
		}
		if hasPreview {
			if _, perr := tx.Exec(query.InsertLinkPreview, info.ID, lpURL, lpTitle, lpDesc, lpThumb,
				lpDirectPath, lpMediaKey, lpFileSHA, lpFileEncSHA); perr != nil {
				return perr
			}
		}
		// Store structured poll data if this is a poll creation message.
		if pollName != "" {
			if _, perr := tx.Exec(query.InsertPoll, info.ID, pollName, pollOptionsJSON, pollSelectable); perr != nil {
				return perr
			}
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
			gifPlayback,
			thumbnail,
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
			fileName.String,
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
			fileName      sql.NullString
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
			return nil, err
		}
		media = wa.NewMedia(
			directPath.String,
			mediaKey, fileSHA256, fileEncSHA256,
			url.String,
			mimetype.String,
			width, height,
			mtypes.MediaType(mediaType),
			fileName.String,
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

// ChatListPreview shortens the stored HTML text for the chat list subtitle.
var pollPreviewRE = regexp.MustCompile(`<b>([^<]*)</b>`)

func ChatListPreview(text string) string {
	if !strings.HasPrefix(text, `<div class="msg-card msg-poll">`) {
		return text
	}
	if m := pollPreviewRE.FindStringSubmatch(text); m != nil {
		return "📊 " + m[1]
	}
	return "📊 Poll"
}

// GetChatList returns the chat list from messages.db
// GetChatList returns the regular chat list (channels/broadcast excluded).
func (ms *MessageStore) GetChatList() []ChatMessage {
	return ms.chatListFromQuery(query.SelectDecodedChatList)
}

// GetChannelList returns only Channel (newsletter) feeds.
func (ms *MessageStore) GetChannelList() []ChatMessage {
	return ms.chatListFromQuery(query.SelectDecodedChannelList)
}

func (ms *MessageStore) chatListFromQuery(q string) []ChatMessage {
	rows, err := ms.db.Query(q)
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
			messageText = ChatListPreview(text.String)
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

// GetPollByMessageID returns the structured poll data for a poll creation
func (ms *MessageStore) GetPollByMessageID(messageID string) (PollInfo, error) {
	var (
		name     string
		optsJSON string
		sel      int
	)
	err := ms.db.QueryRow(query.SelectPollByMessageID, messageID).Scan(&name, &optsJSON, &sel)
	if err != nil {
		return PollInfo{}, err
	}
	var opts []string
	_ = json.Unmarshal([]byte(optsJSON), &opts)
	poll := PollInfo{Name: name, Options: opts, SelectableCount: sel}
	if votes, verr := ms.GetPollVotes(messageID); verr == nil && len(votes) > 0 {
		poll.Votes = votes
	}
	return poll, nil
}

func (ms *MessageStore) GetPollVotes(pollMessageID string) ([]PollVote, error) {
	rows, err := ms.db.Query(query.SelectPollVotesByMessageID, pollMessageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var votes []PollVote
	for rows.Next() {
		var (
			senderJID string
			optsJSON  string
			updatedAt int64
		)
		if err := rows.Scan(&senderJID, &optsJSON, &updatedAt); err != nil {
			return nil, err
		}
		var opts []string
		_ = json.Unmarshal([]byte(optsJSON), &opts)
		votes = append(votes, PollVote{SenderJID: senderJID, Options: opts, UpdatedAt: updatedAt})
	}
	return votes, rows.Err()
}

func (ms *MessageStore) UpsertPollVote(pollMessageID, senderJID string, options []string) error {
	optsJSON, _ := json.Marshal(options)
	_, err := ms.db.Exec(query.UpsertPollVote, pollMessageID, senderJID, string(optsJSON), time.Now().UnixMilli())
	return err
}

func (ms *MessageStore) DeletePollVote(pollMessageID, senderJID string) error {
	_, err := ms.db.Exec(query.DeletePollVote, pollMessageID, senderJID)
	return err
}

// GetPollMessageInfo returns the stored message info needed to build a poll vote
func (ms *MessageStore) GetPollMessageInfo(messageID string) (chatJID, senderJID string, isFromMe bool, timestamp int64, err error) {
	err = ms.db.QueryRow(query.SelectPollMessageInfo, messageID).Scan(&chatJID, &senderJID, &isFromMe, &timestamp)
	return
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
		width = int(msg.GetVideoMessage().GetWidth())
		height = int(msg.GetVideoMessage().GetHeight())
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
	case msg.GetPtvMessage() != nil:
		// Round video notes are plain VideoMessages in a different envelope.
		emc = msg.GetPtvMessage()
		width = int(msg.GetPtvMessage().GetWidth())
		height = int(msg.GetPtvMessage().GetHeight())
		mediaType = mtypes.MediaTypeVideo
		if contextInfo := msg.GetPtvMessage().GetContextInfo(); contextInfo != nil {
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

type decodedPageRow struct {
	message     DecodedMessage
	text        string
	fileName    string
	width       int
	height      int
	gif         bool
	linkPreview *DecodedLinkPreview
}

type quotedContent struct {
	sender  string
	content *DecodedMessageContent
}

// GetDecodedMessagesPaged returns a stable page of decoded messages. The
// timestamp and message ID form a compound cursor, so messages that share the
// same second cannot fall between pages.
func (ms *MessageStore) GetDecodedMessagesPaged(chatJID string, beforeTimestamp int64, beforeMessageID string, limit int) ([]DecodedMessage, error) {
	var rows *sql.Rows
	var err error

	if beforeTimestamp == 0 {
		rows, err = ms.db.Query(query.SelectLatestMessagesByChat, chatJID, limit)
	} else {
		rows, err = ms.db.Query(
			query.SelectMessagesByChatBeforeCursor,
			chatJID,
			beforeTimestamp,
			beforeTimestamp,
			beforeMessageID,
			limit,
		)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := make([]decodedPageRow, 0, limit)

	for rows.Next() {
		var (
			msgID              string
			chatJIDRow         string
			senderJID          string
			timestamp          int64
			isFromMe           bool
			text               sql.NullString
			replyTo            sql.NullString
			edited, forwarded  bool
			msgType            sql.NullInt32
			fileName           sql.NullString
			width, height      sql.NullInt64
			gif                sql.NullBool
			previewURL         sql.NullString
			previewTitle       sql.NullString
			previewDescription sql.NullString
			previewHasPoster   sql.NullBool
		)

		err := rows.Scan(
			&msgID,
			&chatJIDRow,
			&senderJID,
			&timestamp,
			&isFromMe,
			&text,
			&replyTo,
			&edited,
			&forwarded,
			&msgType,
			&fileName,
			&width,
			&height,
			&gif,
			&previewURL,
			&previewTitle,
			&previewDescription,
			&previewHasPoster,
		)
		if err != nil {
			return nil, err
		}

		var linkPreview *DecodedLinkPreview
		if previewURL.Valid || previewTitle.Valid || previewDescription.Valid || previewHasPoster.Bool {
			linkPreview = &DecodedLinkPreview{
				URL: previewURL.String, Title: previewTitle.String,
				Description: previewDescription.String, HasPoster: previewHasPoster.Bool,
			}
		}
		page = append(page, decodedPageRow{
			message: DecodedMessage{
				Type:             mtypes.MediaType(msgType.Int32),
				ReplyToMessageID: replyTo.String,
				Edited:           edited,
				Forwarded:        forwarded,
				Info: DecodedMessageInfo{
					ID:        msgID,
					Timestamp: time.Unix(timestamp, 0).Format(time.RFC3339),
					IsFromMe:  isFromMe,
					PushName:  "",
					Sender:    senderJID,
					Chat:      chatJIDRow,
				},
			},
			text:        text.String,
			fileName:    fileName.String,
			width:       int(width.Int64),
			height:      int(height.Int64),
			gif:         gif.Bool,
			linkPreview: linkPreview,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	messageIDs := make([]string, 0, len(page))
	quotedIDs := make([]string, 0, len(page))
	for i := range page {
		messageIDs = append(messageIDs, page[i].message.Info.ID)
		if page[i].message.ReplyToMessageID != "" {
			quotedIDs = append(quotedIDs, page[i].message.ReplyToMessageID)
		}
	}

	reactions, err := ms.loadReactionsByMessageIDs(messageIDs)
	if err != nil {
		return nil, err
	}
	polls, err := ms.loadPollsByMessageIDs(messageIDs)
	if err != nil {
		return nil, err
	}
	quoted, err := ms.loadQuotedContents(quotedIDs)
	if err != nil {
		return nil, err
	}

	messages := make([]DecodedMessage, 0, len(page))
	for i := range page {
		item := &page[i]
		item.message.Reactions = reactions[item.message.Info.ID]
		item.message.LinkPreview = item.linkPreview
		if poll, ok := polls[item.message.Info.ID]; ok {
			item.message.Poll = &poll
		}

		var contextInfo *ContextInfo
		if replyID := item.message.ReplyToMessageID; replyID != "" {
			contextInfo = &ContextInfo{StanzaID: replyID}
			if quote, ok := quoted[replyID]; ok {
				contextInfo.Participant = quote.sender
				contextInfo.QuotedMessage = quote.content
			}
		}
		item.message.Content = buildDecodedContentValues(
			item.text,
			item.fileName,
			item.message.Type,
			item.width,
			item.height,
			item.gif,
			contextInfo,
		)
		messages = append(messages, item.message)
	}

	return messages, nil
}

func placeholders(ids []string) (string, []any) {
	marks := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		marks[i] = "?"
		args[i] = id
	}
	return strings.Join(marks, ","), args
}

func (ms *MessageStore) loadReactionsByMessageIDs(messageIDs []string) (map[string][]Reaction, error) {
	result := make(map[string][]Reaction, len(messageIDs))
	if len(messageIDs) == 0 {
		return result, nil
	}
	marks, args := placeholders(messageIDs)
	rows, err := ms.db.Query(query.SelectReactionsByMessageIDsPrefix+marks+") ORDER BY id ASC", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var reaction Reaction
		if err := rows.Scan(&reaction.ID, &reaction.MessageID, &reaction.SenderID, &reaction.Emoji); err != nil {
			return nil, err
		}
		result[reaction.MessageID] = append(result[reaction.MessageID], reaction)
	}
	return result, rows.Err()
}

func (ms *MessageStore) loadPollsByMessageIDs(messageIDs []string) (map[string]PollInfo, error) {
	result := make(map[string]PollInfo, len(messageIDs))
	if len(messageIDs) == 0 {
		return result, nil
	}
	marks, args := placeholders(messageIDs)
	rows, err := ms.db.Query(
		"SELECT message_id, name, options_json, selectable_count FROM polls WHERE message_id IN ("+marks+")",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			messageID string
			name      string
			optsJSON  string
			sel       int
		)
		if err := rows.Scan(&messageID, &name, &optsJSON, &sel); err != nil {
			return nil, err
		}
		var opts []string
		_ = json.Unmarshal([]byte(optsJSON), &opts)
		result[messageID] = PollInfo{Name: name, Options: opts, SelectableCount: sel}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	votes, err := ms.loadVotesByPollMessageIDs(messageIDs)
	if err != nil {
		return nil, err
	}
	for id, poll := range result {
		vs := votes[id]
		if len(vs) > 0 {
			poll.Votes = vs
			result[id] = poll
		}
	}
	return result, nil
}

func (ms *MessageStore) loadVotesByPollMessageIDs(messageIDs []string) (map[string][]PollVote, error) {
	result := make(map[string][]PollVote, len(messageIDs))
	if len(messageIDs) == 0 {
		return result, nil
	}
	marks, args := placeholders(messageIDs)
	rows, err := ms.db.Query(
		"SELECT poll_message_id, sender_jid, options_json, updated_at FROM poll_votes WHERE poll_message_id IN ("+marks+") ORDER BY updated_at ASC",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			pollMessageID string
			senderJID     string
			optsJSON      string
			updatedAt     int64
		)
		if err := rows.Scan(&pollMessageID, &senderJID, &optsJSON, &updatedAt); err != nil {
			return nil, err
		}
		var opts []string
		_ = json.Unmarshal([]byte(optsJSON), &opts)
		result[pollMessageID] = append(result[pollMessageID], PollVote{SenderJID: senderJID, Options: opts, UpdatedAt: updatedAt})
	}
	return result, rows.Err()
}

func (ms *MessageStore) loadQuotedContents(messageIDs []string) (map[string]quotedContent, error) {
	result := make(map[string]quotedContent, len(messageIDs))
	if len(messageIDs) == 0 {
		return result, nil
	}
	marks, args := placeholders(messageIDs)
	rows, err := ms.db.Query(query.SelectDecodedMessagesByIDPrefix+marks+")", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			messageID     string
			sender        string
			text          sql.NullString
			msgType       sql.NullInt32
			fileName      sql.NullString
			width, height sql.NullInt64
			gif           sql.NullBool
		)
		if err := rows.Scan(&messageID, &sender, &text, &msgType, &fileName, &width, &height, &gif); err != nil {
			return nil, err
		}
		result[messageID] = quotedContent{
			sender: sender,
			content: buildDecodedContentValues(
				text.String,
				fileName.String,
				mtypes.MediaType(msgType.Int32),
				int(width.Int64),
				int(height.Int64),
				gif.Bool,
				nil,
			),
		}
	}
	return result, rows.Err()
}

// buildDecodedContent creates a DecodedMessageContent from DecodedMessage fields
func (ms *MessageStore) buildDecodedContent(
	chatJID, messageID, text, replyToMessageId, fileName string,
	mediaType mtypes.MediaType,
) *DecodedMessageContent {
	var contextInfo *ContextInfo
	if replyToMessageId != "" {
		contextInfo = &ContextInfo{StanzaID: replyToMessageId}
		if quoted, err := ms.loadQuotedContents([]string{replyToMessageId}); err == nil {
			if quote, ok := quoted[replyToMessageId]; ok {
				contextInfo.Participant = quote.sender
				contextInfo.QuotedMessage = quote.content
			}
		}
	}
	width, height := ms.mediaDimensions(messageID)
	return buildDecodedContentValues(text, fileName, mediaType, width, height, ms.isGifPlayback(messageID), contextInfo)
}

func buildDecodedContentValues(
	text, fileName string,
	mediaType mtypes.MediaType,
	width, height int,
	gifPlayback bool,
	contextInfo *ContextInfo,
) *DecodedMessageContent {
	content := &DecodedMessageContent{}

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
			Width:       width,
			Height:      height,
			ContextInfo: contextInfo,
		}
	case mtypes.MediaTypeVideo:
		content.VideoMessage = &MediaMessageContent{
			Caption:     text,
			GifPlayback: gifPlayback,
			Width:       width,
			Height:      height,
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
			Width:       width,
			Height:      height,
			ContextInfo: contextInfo,
		}
	default:
		content.Conversation = text
	}

	return content
}

// mediaDimensions returns the stored intrinsic width/height for a media
// message so the frontend can reserve the final layout box before the media
// loads (prevents scroll jumps in the virtualized list). Returns zeros when
// unknown (older rows or protos without dimensions).
func (ms *MessageStore) mediaDimensions(messageID string) (int, int) {
	if messageID == "" {
		return 0, 0
	}
	var width, height sql.NullInt64
	if err := ms.db.QueryRow(query.SelectDimensionsByMessageID, messageID).Scan(&width, &height); err != nil {
		return 0, 0
	}
	return int(width.Int64), int(height.Int64)
}

// isGifPlayback reports whether a video message was flagged as GIF playback
// (short, looping, muted). Missing rows / older messages default to false.
func (ms *MessageStore) isGifPlayback(messageID string) bool {
	if messageID == "" {
		return false
	}
	var gif sql.NullBool
	if err := ms.db.QueryRow(query.SelectGifPlaybackByMessageID, messageID).Scan(&gif); err != nil {
		return false
	}
	return gif.Bool
}

// GetThumbnail returns the stored preview JPEG bytes for a message, or nil if
// none was stored (e.g. messages synced before the thumbnail column existed).
func (ms *MessageStore) GetThumbnail(messageID string) []byte {
	var thumb []byte
	if err := ms.db.QueryRow(query.SelectThumbnailByMessageID, messageID).Scan(&thumb); err != nil {
		return nil
	}
	return thumb
}

func (ms *MessageStore) CacheThumbnail(messageID string, data []byte) error {
	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.UpdateThumbnailByMessageID, data, messageID)
		return err
	})
}

// LinkPreview is the stored preview for a URL in a text message.
type LinkPreview struct {
	URL         string
	Title       string
	Description string
	Thumbnail   []byte
}

// GetLinkPreview returns the stored link preview for a message, or nil if none.
func (ms *MessageStore) GetLinkPreview(messageID string) *LinkPreview {
	var lp LinkPreview
	err := ms.db.QueryRow(query.SelectLinkPreviewByMessageID, messageID).
		Scan(&lp.URL, &lp.Title, &lp.Description, &lp.Thumbnail)
	if err != nil {
		return nil
	}
	return &lp
}

// LinkPreviewMedia holds a cached poster (if any) and the keys to download it.
type LinkPreviewMedia struct {
	Thumbnail     []byte
	DirectPath    string
	MediaKey      []byte
	FileSHA256    []byte
	FileEncSHA256 []byte
}

// GetLinkPreviewMedia returns the cached poster and its download keys.
func (ms *MessageStore) GetLinkPreviewMedia(messageID string) *LinkPreviewMedia {
	var m LinkPreviewMedia
	var dp sql.NullString
	err := ms.db.QueryRow(query.SelectLinkPreviewMediaByMessageID, messageID).
		Scan(&m.Thumbnail, &dp, &m.MediaKey, &m.FileSHA256, &m.FileEncSHA256)
	if err != nil {
		return nil
	}
	m.DirectPath = dp.String
	return &m
}

// CacheLinkPreviewThumbnail stores a downloaded poster so it's only fetched once.
func (ms *MessageStore) CacheLinkPreviewThumbnail(messageID string, data []byte) error {
	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.UpdateLinkPreviewThumbnail, data, messageID)
		return err
	})
}

// GetDecodedMessage returns a single decoded message from messages.db
func (ms *MessageStore) GetDecodedMessage(chatJID string, messageID string) (*DecodedMessage, error) {
	var (
		sender             string
		timestamp          int64
		isFromMe           bool
		replyTo            sql.NullString
		edited, forwarded  bool
		text               sql.NullString
		msgType            sql.NullInt32
		fileName           sql.NullString
		width, height      sql.NullInt64
		gif                sql.NullBool
		previewURL         sql.NullString
		previewTitle       sql.NullString
		previewDescription sql.NullString
		previewHasPoster   sql.NullBool
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
			&width,
			&height,
			&gif,
			&previewURL,
			&previewTitle,
			&previewDescription,
			&previewHasPoster,
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
	if previewURL.Valid || previewTitle.Valid || previewDescription.Valid || previewHasPoster.Bool {
		msg.LinkPreview = &DecodedLinkPreview{
			URL: previewURL.String, Title: previewTitle.String,
			Description: previewDescription.String, HasPoster: previewHasPoster.Bool,
		}
	}

	// Load reactions outside transaction to avoid nested runSync
	reactions, err := ms.GetReactionsByMessageID(messageID)
	if err == nil {
		msg.Reactions = reactions
	}

	// Load structured poll data if present.
	if poll, pollErr := ms.GetPollByMessageID(messageID); pollErr == nil {
		msg.Poll = &poll
	}

	var contextInfo *ContextInfo
	if msg.ReplyToMessageID != "" {
		contextInfo = &ContextInfo{StanzaID: msg.ReplyToMessageID}
		if quoted, loadErr := ms.loadQuotedContents([]string{msg.ReplyToMessageID}); loadErr == nil {
			if quote, ok := quoted[msg.ReplyToMessageID]; ok {
				contextInfo.Participant = quote.sender
				contextInfo.QuotedMessage = quote.content
			}
		}
	}
	msg.Content = buildDecodedContentValues(
		text.String,
		fileName.String,
		msg.Type,
		int(width.Int64),
		int(height.Int64),
		gif.Bool,
		contextInfo,
	)

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
		msg.Content = ms.buildDecodedContent(chat, messageId, text.String, msg.ReplyToMessageID, fileName.String, msg.Type)

		messages = append(messages, msg)
	}

	return messages, nil
}

// ---- Pins ----

// PinnedMessage is a pinned message row joined with its stored text, used by
// the pinned-messages banner in a chat.
type PinnedMessage struct {
	MessageID string `json:"message_id"`
	SenderJID string `json:"sender_jid"`
	PinnedAt  int64  `json:"pinned_at"`
	Text      string `json:"text"`
}

// GetPinnedMessages returns the non-expired pinned messages of a chat in pin
// order (oldest first).
func (ms *MessageStore) GetPinnedMessages(chatJID string) ([]PinnedMessage, error) {
	rows, err := ms.db.Query(query.GetChatPinnedMessagesWithText, chatJID, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pins []PinnedMessage
	for rows.Next() {
		var p PinnedMessage
		if err := rows.Scan(&p.MessageID, &p.SenderJID, &p.PinnedAt, &p.Text); err != nil {
			return nil, err
		}
		pins = append(pins, p)
	}
	return pins, rows.Err()
}

// ApplyMessagePin records a locally-sent pin/unpin so the UI reflects it
// immediately (incoming pin events are handled by ProcessMessageEvent).
func (ms *MessageStore) ApplyMessagePin(chatJID, senderJID, messageID string, pin bool, expiry int64) error {
	if pin {
		_, err := ms.db.Exec(query.InsertPinnedMessages,
			messageID, chatJID, senderJID, time.Now().Unix(), expiry)
		return err
	}
	_, err := ms.db.Exec(query.DeletePinnedMessageByMessageId, messageID)
	return err
}

// SetChatPinned stores whether a chat is pinned in the chat list.
func (ms *MessageStore) SetChatPinned(chatJID string, pinned bool, ts int64) error {
	if pinned {
		_, err := ms.db.Exec(query.UpsertPinnedChat, chatJID, ts)
		return err
	}
	_, err := ms.db.Exec(query.DeletePinnedChat, chatJID)
	return err
}

// GetPinnedChats returns chat JID -> pinned-at for every pinned chat.
func (ms *MessageStore) GetPinnedChats() map[string]int64 {
	pins := make(map[string]int64)
	rows, err := ms.db.Query(query.SelectPinnedChats)
	if err != nil {
		return pins
	}
	defer rows.Close()
	for rows.Next() {
		var jid string
		var ts int64
		if rows.Scan(&jid, &ts) == nil {
			pins[jid] = ts
		}
	}
	return pins
}

// SetChatArchived stores whether a chat is archived.
func (ms *MessageStore) SetChatArchived(chatJID string, archived bool, ts int64) error {
	if archived {
		_, err := ms.db.Exec(query.UpsertArchivedChat, chatJID, ts)
		return err
	}
	_, err := ms.db.Exec(query.DeleteArchivedChat, chatJID)
	return err
}

// GetArchivedChats returns chat JID -> archived-at for every archived chat.
func (ms *MessageStore) GetArchivedChats() map[string]int64 {
	archived := make(map[string]int64)
	rows, err := ms.db.Query(query.SelectArchivedChats)
	if err != nil {
		return archived
	}
	defer rows.Close()
	for rows.Next() {
		var jid string
		var ts int64
		if rows.Scan(&jid, &ts) == nil {
			archived[jid] = ts
		}
	}
	return archived
}

// MarkMessageDeleted replaces a revoked message's content with a deleted
// marker, mirroring WhatsApp's "This message was deleted".
func (ms *MessageStore) MarkMessageDeleted(messageID string) error {
	_, err := ms.db.Exec(
		`UPDATE messages SET text = ?, has_media = 0 WHERE message_id = ?`,
		`<i>🚫 This message was deleted</i>`, messageID)
	return err
}
