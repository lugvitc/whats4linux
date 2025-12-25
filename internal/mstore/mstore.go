package mstore

import (
	"sort"
	"sync"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

type Message struct {
	Info    types.MessageInfo
	Content *waE2E.Message
}

type MessageStore struct {
	mu     sync.RWMutex
	msgMap map[types.JID][]Message
}

func NewMessageStore() *MessageStore {
	return &MessageStore{
		msgMap: make(map[types.JID][]Message),
	}
}

func (ms *MessageStore) ProcessMessageEvent(msg *events.Message) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	chat := msg.Info.Chat
	ms.msgMap[chat] = append(ms.msgMap[chat], Message{
		Info:    msg.Info,
		Content: msg.Message,
	})
}

func (ms *MessageStore) GetMessages(jid types.JID) []Message {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	return ms.msgMap[jid]
}

func (ms *MessageStore) GetMessage(chatJID types.JID, messageID string) *Message {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	msgs, ok := ms.msgMap[chatJID]
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
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	var chatList []ChatMessage
	for jid, messages := range ms.msgMap {
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
