package store

import (
	"bytes"
	"database/sql"
	"encoding/gob"
	"log"
	"sort"

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

type MessageStore struct {
	db     *sql.DB
	msgMap misc.VMap[types.JID, []Message]
	mCache misc.VMap[string, uint8]
}

func NewMessageStore() (*MessageStore, error) {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("mdb"))
	if err != nil {
		return nil, err
	}
	ms := &MessageStore{
		db:     db,
		msgMap: misc.NewVMap[types.JID, []Message](),
		mCache: misc.NewVMap[string, uint8](),
	}

	if err := ms.initSchema(); err != nil {
		return nil, err
	}

	if err := ms.loadMessagesFromDB(); err != nil {
		return nil, err
	}

	return ms, nil
}

func (ms *MessageStore) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS messages (
		chat TEXT NOT NULL,
		message_id TEXT PRIMARY KEY,
		timestamp INTEGER,
		msg_info BLOB,
		raw_message BLOB
	);

	CREATE INDEX IF NOT EXISTS idx_messages_chat_time
	ON messages(chat, timestamp DESC);
	`
	_, err := ms.db.Exec(schema)
	return err
}

func (ms *MessageStore) ProcessMessageEvent(msg *events.Message) {
	if _, exists := ms.mCache.Get(msg.Info.ID); exists {
		return
	}
	ms.mCache.Set(msg.Info.ID, 1)
	chat := msg.Info.Chat
	ml, _ := ms.msgMap.Get(chat)

	m := Message{
		Info:    msg.Info,
		Content: msg.Message,
	}

	ml = append(ml, m)
	ms.msgMap.Set(chat, ml)

	err := ms.insertMessageToDB(&m)
	if err != nil {
		log.Println(err)
	}
}

func (ms *MessageStore) GetMessages(jid types.JID) []Message {
	ml, _ := ms.msgMap.Get(jid)
	return ml
}

func (ms *MessageStore) GetMessage(chatJID types.JID, messageID string) *Message {
	msgs, ok := ms.msgMap.Get(chatJID)
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
	var chatList []ChatMessage
	msgMap, mu := ms.msgMap.GetMapWithMutex()
	mu.RLock()
	defer mu.RUnlock()
	for jid, messages := range msgMap {
		if len(messages) == 0 {
			continue
		}
		latestMsg := messages[len(messages)-1]
		var messageText string
		if latestMsg.Content.GetConversation() != "" {
			messageText = latestMsg.Content.GetConversation()
		} else if latestMsg.Content.GetExtendedTextMessage() != nil {
			messageText = latestMsg.Content.GetExtendedTextMessage().GetText()
		} else {
			switch {
			case latestMsg.Content.GetImageMessage() != nil:
				messageText = "image"
			case latestMsg.Content.GetVideoMessage() != nil:
				messageText = "video"
			case latestMsg.Content.GetAudioMessage() != nil:
				messageText = "audio"
			case latestMsg.Content.GetDocumentMessage() != nil:
				messageText = "document"
			case latestMsg.Content.GetStickerMessage() != nil:
				messageText = "sticker"
			default:
				messageText = "unsupported message type"
			}
		}
		chatList = append(chatList, ChatMessage{
			JID:         jid,
			MessageText: messageText,
			MessageTime: latestMsg.Info.Timestamp.Unix(),
		})
	}
	sort.Slice(chatList, func(i, j int) bool {
		return chatList[i].MessageTime > chatList[j].MessageTime
	})
	return chatList
}

func (ms *MessageStore) loadMessagesFromDB() error {
	rows, err := ms.db.Query(`
		SELECT chat, message_id, timestamp, msg_info, raw_message
		FROM messages
		ORDER BY timestamp ASC
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			chat  string
			msgID string
			ts    int64
			minf  []byte
			raw   []byte
		)

		if err := rows.Scan(&chat, &msgID, &ts, &minf, &raw); err != nil {
			return err
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

		chatJID, err := types.ParseJID(chat)
		if err != nil {
			continue
		}

		ml, _ := ms.msgMap.Get(chatJID)
		ms.msgMap.Set(chatJID, append(ml, Message{
			Info:    messageInfo,
			Content: waMsg,
		}))
		ms.mCache.Set(msgID, 1)
	}
	return nil
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

	_, err = ms.db.Exec(`
		INSERT OR IGNORE INTO messages
		(chat, message_id, timestamp, msg_info, raw_message)
		VALUES (?, ?, ?, ?, ?)
	`,
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
