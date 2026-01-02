package store

import (
	"bytes"
	"database/sql"
	"encoding/gob"
	"log"
	"time"

	"github.com/AnimeKaizoku/cacher"
	query "github.com/lugvitc/whats4linux/internal/db"
	"github.com/lugvitc/whats4linux/internal/misc"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type Message struct {
	Info    types.MessageInfo
	Content *waE2E.Message
}

const MaxMessageCacheSize = 50

type MessageStore struct {
	db *sql.DB
	// [chatJID.User] = []Message
	msgMap *cacher.Cacher[string, []Message]
	// [chatJID.User] = ChatMessage
	chatListMap *cacher.Cacher[string, ChatMessage]
	mCache      misc.VMap[string, uint8]
}

func NewMessageStore() (*MessageStore, error) {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("mdb"))
	if err != nil {
		return nil, err
	}
	msgCache := cacher.NewCacher[string, []Message](
		&cacher.NewCacherOpts{
			TimeToLive:    30 * time.Minute,
			Revaluate:     true,
			CleanInterval: 40 * time.Minute,
		},
	)

	// Configure chat list cache (decentralized, separate from messages)
	chatListCache := cacher.NewCacher[string, ChatMessage](
		&cacher.NewCacherOpts{
			TimeToLive:    10 * time.Minute,
			Revaluate:     true,
			CleanInterval: 15 * time.Minute,
		},
	)

	ms := &MessageStore{
		db:          db,
		msgMap:      msgCache,
		chatListMap: chatListCache,
		mCache:      misc.NewVMap[string, uint8](),
	}

	if err := ms.initSchema(); err != nil {
		return nil, err
	}

	return ms, nil
}

func (ms *MessageStore) initSchema() error {
	_, err := ms.db.Exec(query.CreateSchema)
	return err
}

func (ms *MessageStore) ProcessMessageEvent(msg *events.Message) {
	if _, exists := ms.mCache.Get(msg.Info.ID); exists {
		return
	}
	ms.mCache.Set(msg.Info.ID, 1)
	chat := msg.Info.Chat.User
	ml, _ := ms.msgMap.Get(chat)

	m := Message{
		Info:    msg.Info,
		Content: msg.Message,
	}

	ml = append(ml, m)
	ms.msgMap.Set(chat, ml)

	// Invalidate specific chat in chatListMap
	ms.chatListMap.Delete(chat)

	err := ms.insertMessageToDB(&m)
	if err != nil {
		log.Println(err)
	}
}

func (ms *MessageStore) GetMessages(jid types.JID) []Message {
	ml, ok := ms.msgMap.Get(jid.User)
	if !ok {
		return []Message{}
	}
	return ml
}

func getMessageArrayFromRows(rows *sql.Rows) []Message {
	var (
		messages []Message
		chat     string
		msgID    string
		ts       int64
		minf     []byte
		raw      []byte
	)

	for rows.Next() {
		minf = minf[:0]
		raw = raw[:0]

		if err := rows.Scan(&chat, &msgID, &ts, &minf, &raw); err != nil {
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
		})
	}

	return messages
}

// GetMessagesPaged returns a page of messages for a chat
// beforeTimestamp: only return messages before this timestamp (0 = latest)
// limit: max number of messages to return
// Returns messages in chronological order (oldest first within the page)
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

// loadMessagesFromDBForChat loads messages for a specific chat from DB
func (ms *MessageStore) loadMessagesFromDBForChat(jid types.JID) []Message {
	rows, err := ms.db.Query(query.SelectMessagesByChat, jid.String())
	if err != nil {
		return []Message{}
	}
	defer rows.Close()

	return getMessageArrayFromRows(rows)
}

// GetTotalMessageCount returns the total number of messages in a chat
func (ms *MessageStore) GetTotalMessageCount(jid types.JID) int {
	ml, ok := ms.msgMap.Get(jid.User)
	if !ok {
		// Load from DB to get count
		ml = ms.loadMessagesFromDBForChat(jid)
		ms.msgMap.Set(jid.User, ml)
		return len(ml)
	}
	return len(ml)
}

func (ms *MessageStore) GetMessage(chatJID types.JID, messageID string) *Message {
	msgs, ok := ms.msgMap.Get(chatJID.User)
	if !ok {
		return nil
	}
	for _, msg := range msgs {
		if msg.Info.ID == messageID {
			return &msg
		}
	}
	return nil
}

type ChatMessage struct {
	JID         types.JID
	MessageText string
	MessageTime int64
}

func (ms *MessageStore) GetChatList() []ChatMessage {
	rows, err := ms.db.Query(query.SelectChatList)
	if err != nil {
		return []ChatMessage{}
	}
	defer rows.Close()

	var chatList []ChatMessage

	var (
		chat  string
		msgID string
		ts    int64
		minf  []byte
		raw   []byte
	)

	for rows.Next() {
		minf = minf[:0]
		raw = raw[:0]

		if err := rows.Scan(&chat, &msgID, &ts, &minf, &raw); err != nil {
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
		if waMsg.GetConversation() != "" {
			messageText = waMsg.GetConversation()
		} else if waMsg.GetExtendedTextMessage() != nil {
			messageText = waMsg.GetExtendedTextMessage().GetText()
		} else {
			switch {
			case waMsg.GetImageMessage() != nil:
				messageText = "image"
			case waMsg.GetVideoMessage() != nil:
				messageText = "video"
			case waMsg.GetAudioMessage() != nil:
				messageText = "audio"
			case waMsg.GetDocumentMessage() != nil:
				messageText = "document"
			case waMsg.GetStickerMessage() != nil:
				messageText = "sticker"
			default:
				messageText = "unsupported message type"
			}
		}

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

	_, err = ms.db.Exec(query.InsertMessage,
		msg.Info.Chat.String(),
		msg.Info.ID,
		msg.Info.Timestamp.Unix(),
		msgInfo,
		rawMessage,
	)
	return err
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
