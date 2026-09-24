package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/lugvitc/whats4linux/internal/markdown"
	"github.com/lugvitc/whats4linux/internal/store"
	mtypes "github.com/lugvitc/whats4linux/internal/types"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.mau.fi/util/random"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/whatsmeow/util/gcmutil"
	"go.mau.fi/whatsmeow/util/hkdfutil"
	"google.golang.org/protobuf/proto"
)

type MessageContent struct {
	Type            string   `json:"type"`
	Text            string   `json:"text,omitempty"`
	Base64Data      string   `json:"base64Data,omitempty"`
	Mimetype        string   `json:"mimetype,omitempty"`
	FileName        string   `json:"fileName,omitempty"`
	QuotedMessageID string   `json:"quotedMessageId,omitempty"`
	Mentions        []string `json:"mentions,omitempty"`
	ClientTempID    string   `json:"clientTempId,omitempty"`
	PollOptions     []string `json:"pollOptions,omitempty"`
	SelectableCount int      `json:"selectableCount,omitempty"`
}

func (a *Api) processMessageText(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	var text string
	var mentionedJIDs []string

	if msg.GetConversation() != "" {
		text = msg.GetConversation()
	} else if msg.GetExtendedTextMessage() != nil {
		text = msg.GetExtendedTextMessage().GetText()
		if msg.GetExtendedTextMessage().GetContextInfo() != nil {
			mentionedJIDs = msg.GetExtendedTextMessage().GetContextInfo().GetMentionedJID()
		}
	} else {
		switch {
		case msg.GetImageMessage() != nil:
			text = msg.GetImageMessage().GetCaption()
			if msg.GetImageMessage().GetContextInfo() != nil {
				mentionedJIDs = msg.GetImageMessage().GetContextInfo().GetMentionedJID()
			}
		case msg.GetVideoMessage() != nil:
			text = msg.GetVideoMessage().GetCaption()
			if msg.GetVideoMessage().GetContextInfo() != nil {
				mentionedJIDs = msg.GetVideoMessage().GetContextInfo().GetMentionedJID()
			}
		case msg.GetDocumentMessage() != nil:
			text = msg.GetDocumentMessage().GetCaption()
			if msg.GetDocumentMessage().GetContextInfo() != nil {
				mentionedJIDs = msg.GetDocumentMessage().GetContextInfo().GetMentionedJID()
			}
		}
	}

	if text == "" {
		return ""
	}

	// First convert Markdown to HTML (which handles escaping)
	htmlText := markdown.MarkdownLinesToHTML(text)

	// Then replace mentions in the HTML
	if len(mentionedJIDs) > 0 {
		htmlText = replaceMentions(htmlText, mentionedJIDs, a)
	}

	return htmlText
}

func (a *Api) FetchMessagesPaged(jid string, limit int, beforeTimestamp int64, beforeMessageID string) ([]store.DecodedMessage, error) {
	messages, err := a.messageStore.GetDecodedMessagesPaged(jid, beforeTimestamp, beforeMessageID, limit)
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func buildQuotedMessage(msg *store.ExtendedMessage) *waE2E.Message {
	if msg == nil {
		return nil
	}
	var quotedMessage waE2E.Message
	if msg.ReplyToMessageID == "" {
		quotedMessage.Conversation = proto.String(msg.Text)
	} else {
		quotedMessage.ExtendedTextMessage = &waE2E.ExtendedTextMessage{
			Text: proto.String(msg.Text),
		}
	}

	if msg.Media == nil {
		return &quotedMessage
	}

	switch msg.Media.GetMediaGeneralType() {
	case mtypes.MediaTypeImage:
		width, height := msg.Media.GetDimensions()
		quotedMessage.ImageMessage = &waE2E.ImageMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Caption:       proto.String(msg.Text),
			FileSHA256:    msg.Media.GetFileSHA256(),
			Width:         proto.Uint32(uint32(width)),
			Height:        proto.Uint32(uint32(height)),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	case mtypes.MediaTypeVideo:
		quotedMessage.VideoMessage = &waE2E.VideoMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Caption:       proto.String(msg.Text),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	case mtypes.MediaTypeAudio:
		quotedMessage.AudioMessage = &waE2E.AudioMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	case mtypes.MediaTypeDocument:
		quotedMessage.DocumentMessage = &waE2E.DocumentMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Caption:       proto.String(msg.Text),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	case mtypes.MediaTypeSticker:
		quotedMessage.StickerMessage = &waE2E.StickerMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	}

	return &quotedMessage
}

func (a *Api) buildQuotedContext(chatJID types.JID, quotedMessageID string) (*waE2E.ContextInfo, error) {
	if quotedMessageID == "" {
		return nil, nil
	}

	msg, err := a.messageStore.GetMessageWithMedia(chatJID.String(), quotedMessageID)
	if err != nil {
		return nil, fmt.Errorf("quoted message not found")
	}

	quotedMessage := buildQuotedMessage(msg)

	if quotedMessage == nil {
		return nil, fmt.Errorf("failed to build quoted message")
	}

	stanzaID := quotedMessageID
	contextInfo := &waE2E.ContextInfo{
		StanzaID:      &stanzaID,
		QuotedMessage: quotedMessage,
	}

	if msg.Info.Sender.User != "" {
		participantJID := msg.Info.Sender.ToNonAD().String()
		contextInfo.Participant = proto.String(participantJID)
	}

	return contextInfo, nil
}

// SendReaction reacts to a message with an emoji (empty emoji removes the
// reaction). senderJID is the original message's sender; empty means our own.
func (a *Api) SendReaction(chatJID, senderJID, messageID, emoji string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}
	sender := *a.waClient.Store.ID
	if senderJID != "" {
		if s, perr := types.ParseJID(senderJID); perr == nil {
			sender = s
		}
	}
	reactionMsg := a.waClient.BuildReaction(chat, sender, messageID, emoji)
	if _, err := a.waClient.SendMessage(a.ctx, chat, reactionMsg); err != nil {
		return err
	}
	// Persist our own reaction locally so it survives a reload.
	_ = a.messageStore.AddReactionToMessage(messageID, emoji, a.waClient.Store.ID.String())
	return nil
}

func (a *Api) SendMessage(chatJID string, content MessageContent) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("client not logged in")
	}

	parsedJID, err := types.ParseJID(chatJID)
	if err != nil {
		return "", err
	}

	var msgContent *waE2E.Message
	contextInfo, err := a.buildQuotedContext(parsedJID, content.QuotedMessageID)
	if err != nil {
		log.Println("Failed to build quoted context:", err)
		return "", err
	}

	switch content.Type {
	case "text":

		mentionedJIDs := content.Mentions

		// If we have mentions or quoted context, use ExtendedTextMessage
		if len(mentionedJIDs) > 0 || contextInfo != nil {
			if contextInfo == nil {
				contextInfo = &waE2E.ContextInfo{}
			}
			if len(mentionedJIDs) > 0 {
				contextInfo.MentionedJID = mentionedJIDs
			}
			msgContent = &waE2E.Message{
				ExtendedTextMessage: &waE2E.ExtendedTextMessage{
					Text:        &content.Text,
					ContextInfo: contextInfo,
				},
			}
		} else {
			msgContent = &waE2E.Message{
				Conversation: &content.Text,
			}
		}
	case "image":
		// Decode base64 image data
		imageData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 image data: %v", err)
		}

		// Create image message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "image/jpeg"
		}
		imageMsg := &waE2E.ImageMessage{
			Mimetype:      &mimeType,
			Caption:       &content.Text,
			JPEGThumbnail: nil, // We'll let WhatsApp generate the thumbnail
		}

		if len(content.Mentions) > 0 || contextInfo != nil {
			if contextInfo == nil {
				contextInfo = &waE2E.ContextInfo{}
			}
			if len(content.Mentions) > 0 {
				contextInfo.MentionedJID = content.Mentions
			}
			imageMsg.ContextInfo = contextInfo
		}

		// Upload the image
		uploaded, err := a.waClient.Upload(a.ctx, imageData, whatsmeow.MediaImage)
		if err != nil {
			return "", fmt.Errorf("failed to upload image: %v", err)
		}

		imageMsg.URL = &uploaded.URL
		imageMsg.DirectPath = &uploaded.DirectPath
		imageMsg.MediaKey = uploaded.MediaKey
		imageMsg.FileEncSHA256 = uploaded.FileEncSHA256
		imageMsg.FileSHA256 = uploaded.FileSHA256
		imageMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			ImageMessage: imageMsg,
		}
	case "video":
		// Decode base64 video data
		videoData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 video data: %v", err)
		}

		// Create video message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "video/mp4"
		}
		videoMsg := &waE2E.VideoMessage{
			Mimetype:      &mimeType,
			Caption:       &content.Text,
			JPEGThumbnail: nil, // We'll let WhatsApp generate the thumbnail
		}

		if len(content.Mentions) > 0 || contextInfo != nil {
			if contextInfo == nil {
				contextInfo = &waE2E.ContextInfo{}
			}
			if len(content.Mentions) > 0 {
				contextInfo.MentionedJID = content.Mentions
			}
			videoMsg.ContextInfo = contextInfo
		}

		// Upload the video
		uploaded, err := a.waClient.Upload(a.ctx, videoData, whatsmeow.MediaVideo)
		if err != nil {
			return "", fmt.Errorf("failed to upload video: %v", err)
		}

		videoMsg.URL = &uploaded.URL
		videoMsg.DirectPath = &uploaded.DirectPath
		videoMsg.MediaKey = uploaded.MediaKey
		videoMsg.FileEncSHA256 = uploaded.FileEncSHA256
		videoMsg.FileSHA256 = uploaded.FileSHA256
		videoMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			VideoMessage: videoMsg,
		}
	case "audio":
		// Decode base64 audio data
		audioData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 audio data: %v", err)
		}

		// Create audio message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "audio/ogg"
		}
		audioMsg := &waE2E.AudioMessage{
			Mimetype: &mimeType,
		}

		if contextInfo != nil {
			audioMsg.ContextInfo = contextInfo
		}

		// Upload the audio
		uploaded, err := a.waClient.Upload(a.ctx, audioData, whatsmeow.MediaAudio)
		if err != nil {
			return "", fmt.Errorf("failed to upload audio: %v", err)
		}

		audioMsg.URL = &uploaded.URL
		audioMsg.DirectPath = &uploaded.DirectPath
		audioMsg.MediaKey = uploaded.MediaKey
		audioMsg.FileEncSHA256 = uploaded.FileEncSHA256
		audioMsg.FileSHA256 = uploaded.FileSHA256
		audioMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			AudioMessage: audioMsg,
		}
	case "document":
		// Decode base64 document data
		documentData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 document data: %v", err)
		}

		// Create document message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		fileName := strings.TrimSpace(content.FileName)
		if fileName == "" {
			fileName = "document"
		}
		documentMsg := &waE2E.DocumentMessage{
			Mimetype: &mimeType,
			FileName: &fileName,
			Caption:  &content.Text,
		}

		if len(content.Mentions) > 0 || contextInfo != nil {
			if contextInfo == nil {
				contextInfo = &waE2E.ContextInfo{}
			}
			if len(content.Mentions) > 0 {
				contextInfo.MentionedJID = content.Mentions
			}
			documentMsg.ContextInfo = contextInfo
		}

		// Upload the document
		uploaded, err := a.waClient.Upload(a.ctx, documentData, whatsmeow.MediaDocument)
		if err != nil {
			return "", fmt.Errorf("failed to upload document: %v", err)
		}

		documentMsg.URL = &uploaded.URL
		documentMsg.DirectPath = &uploaded.DirectPath
		documentMsg.MediaKey = uploaded.MediaKey
		documentMsg.FileEncSHA256 = uploaded.FileEncSHA256
		documentMsg.FileSHA256 = uploaded.FileSHA256
		documentMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			DocumentMessage: documentMsg,
		}
	case "sticker":
		// Decode base64 sticker data
		stickerData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 sticker data: %v", err)
		}

		// Create sticker message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "image/webp"
		}
		stickerMsg := &waE2E.StickerMessage{
			Mimetype: &mimeType,
		}
		if contextInfo != nil {
			stickerMsg.ContextInfo = contextInfo
		}

		// Upload the sticker
		uploaded, err := a.waClient.Upload(a.ctx, stickerData, whatsmeow.MediaImage) // Stickers use MediaImage
		if err != nil {
			return "", fmt.Errorf("failed to upload sticker: %v", err)
		}

		stickerMsg.URL = &uploaded.URL
		stickerMsg.DirectPath = &uploaded.DirectPath
		stickerMsg.MediaKey = uploaded.MediaKey
		stickerMsg.FileEncSHA256 = uploaded.FileEncSHA256
		stickerMsg.FileSHA256 = uploaded.FileSHA256
		stickerMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			StickerMessage: stickerMsg,
		}
	case "poll":
		// Poll nameText is the question, PollOptions the choices. selectableCount
		// 1 = single answer, 0 or len(options) = multiple answers allowed.
		name := strings.TrimSpace(content.Text)
		clean := make([]string, 0, len(content.PollOptions))
		for _, o := range content.PollOptions {
			if o = strings.TrimSpace(o); o != "" {
				clean = append(clean, o)
			}
		}
		if name == "" || len(clean) < 2 {
			return "", fmt.Errorf("a poll needs a question and at least two options")
		}
		msgContent = a.waClient.BuildPollCreation(name, clean, content.SelectableCount)
	default:
		return "", fmt.Errorf("unsupported message type: %s", content.Type)
	}

	log.Printf("SendMessage Content: %+v\n", msgContent)

	resp, err := a.waClient.SendMessage(a.ctx, parsedJID, msgContent)
	if err != nil {
		log.Println("SendMessage error:", err)
		return "", err
	}

	// Manually add to store and emit event so UI updates immediately
	msgEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        resp.ID,
			Timestamp: resp.Timestamp,
			MessageSource: types.MessageSource{
				Chat:     parsedJID,
				IsFromMe: true,
				Sender:   *a.waClient.Store.ID,
			},
		},
		Message: msgContent,
	}
	parsedHTML := a.processMessageText(msgContent)
	messageID := a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, msgEvent, parsedHTML)

	// Extract message text for chat list update
	var messageText string
	if msgContent.GetConversation() != "" {
		messageText = msgContent.GetConversation()
	} else if msgContent.GetExtendedTextMessage() != nil {
		messageText = msgContent.GetExtendedTextMessage().GetText()
	} else {
		switch {
		case msgContent.GetImageMessage() != nil:
			messageText = "image"
		case msgContent.GetVideoMessage() != nil:
			messageText = "video"
		case msgContent.GetAudioMessage() != nil:
			messageText = "audio"
		case msgContent.GetDocumentMessage() != nil:
			messageText = "document"
		case msgContent.GetStickerMessage() != nil:
			messageText = "sticker"
		case msgContent.GetPollCreationMessage() != nil:
			messageText = "📊 " + msgContent.GetPollCreationMessage().GetName()
		default:
			messageText = "message"
		}
	}

	var msg any
	if messageID != "" {
		decodedMsg, err := a.messageStore.GetDecodedMessage(parsedJID.String(), messageID)
		if err == nil {
			msg = decodedMsg
		}
	}

	if msg == nil {
		msg = struct {
			Info    types.MessageInfo
			Content *waE2E.Message
		}{
			Info:    msgEvent.Info,
			Content: msgEvent.Message,
		}
	}

	runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
		"chatId":       parsedJID.String(),
		"message":      msg,
		"clientTempId": content.ClientTempID,
		"messageText":  messageText,
		"parsedHTML":   parsedHTML,
		"timestamp":    resp.Timestamp.Unix(),
		"sender":       "You",
	})

	return resp.ID, nil
}
func (a *Api) MarkRead(chatJID string, messageIDs []string, Type string) error {
	parsedChatJID, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}
	if Type == "read-msg" {
		for _, msgID := range messageIDs {
			msg, err := a.messageStore.GetMessageWithMedia(chatJID, msgID)
			if err != nil {
				log.Printf("Failed to get message %s: %v", msgID, err)
				continue
			}
			senderJID := msg.Info.Sender
			ids := []types.MessageID{types.MessageID(msgID)}
			err = a.waClient.MarkRead(a.ctx, ids, time.Now(), parsedChatJID, senderJID)
			if err != nil {
				log.Printf("MarkRead error for message %s: %v", msgID, err)
			}
		}
	}
	return nil
}

// ---- Message pins ----

// PinExpirySeconds mirrors WhatsApp's default pin duration (7 days).
const PinExpirySeconds = 7 * 24 * 60 * 60

func (a *Api) GetPinnedMessages(chatJID string) ([]store.PinnedMessage, error) {
	return a.messageStore.GetPinnedMessages(chatJID)
}

// SetMessagePinned pins or unpins a message for everyone in the chat and
// records the change locally.
func (a *Api) SetMessagePinned(chatJID, senderJID, messageID string, fromMe, pin bool) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}

	key := &waCommon.MessageKey{
		RemoteJID: proto.String(chatJID),
		FromMe:    proto.Bool(fromMe),
		ID:        proto.String(messageID),
	}
	if chat.Server == types.GroupServer && !fromMe && senderJID != "" {
		key.Participant = proto.String(senderJID)
	}

	pinType := waE2E.PinInChatMessage_PIN_FOR_ALL
	if !pin {
		pinType = waE2E.PinInChatMessage_UNPIN_FOR_ALL
	}
	msg := &waE2E.Message{
		PinInChatMessage: &waE2E.PinInChatMessage{
			Key:               key,
			Type:              &pinType,
			SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
		},
		MessageContextInfo: &waE2E.MessageContextInfo{
			MessageAddOnDurationInSecs: proto.Uint32(uint32(PinExpirySeconds)),
		},
	}
	if _, err := a.waClient.SendMessage(a.ctx, chat, msg); err != nil {
		return err
	}

	sender := a.waClient.Store.ID.String()
	if err := a.messageStore.ApplyMessagePin(chatJID, sender, messageID, pin, PinExpirySeconds); err != nil {
		log.Println("SetMessagePinned: failed to persist:", err)
	}
	runtime.EventsEmit(a.ctx, "wa:pinned_update", map[string]any{"chatId": chatJID})
	return nil
}

// sendAndStoreLocal sends a prebuilt message and records it locally so the
// UI shows it immediately, mirroring SendMessage's echo path.
func (a *Api) sendAndStoreLocal(chat types.JID, msgContent *waE2E.Message, preview string) (string, error) {
	resp, err := a.waClient.SendMessage(a.ctx, chat, msgContent)
	if err != nil {
		return "", err
	}
	msgEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        resp.ID,
			Timestamp: resp.Timestamp,
			MessageSource: types.MessageSource{
				Chat:     chat,
				IsFromMe: true,
				Sender:   *a.waClient.Store.ID,
			},
		},
		Message: msgContent,
	}
	messageID := a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, msgEvent, "")

	var msg any
	if messageID != "" {
		if decodedMsg, derr := a.messageStore.GetDecodedMessage(chat.String(), messageID); derr == nil {
			msg = decodedMsg
		}
	}
	runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
		"chatId":      chat.String(),
		"message":     msg,
		"messageText": preview,
		"timestamp":   resp.Timestamp.Unix(),
		"sender":      "You",
		"isFromMe":    true,
	})
	return resp.ID, nil
}

// SendPollVote casts a vote on an existing poll. pollMessageID is the stored
// poll creation message ID. The encryption key is derived by whatsmeow from
// the original message's stored msg-secret, so no extra state is needed here.
func (a *Api) SendPollVote(pollMessageID string, selectedOptions []string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("client not logged in")
	}
	pollChat, pollSender, isFromMe, _, err := a.messageStore.GetPollMessageInfo(pollMessageID)
	if err != nil {
		return fmt.Errorf("poll message not found: %w", err)
	}
	chat, err := types.ParseJID(pollChat)
	if err != nil {
		return err
	}
	sender, err := types.ParseJID(pollSender)
	if err != nil {
		return err
	}
	pollInfo := &types.MessageInfo{
		MessageSource: types.MessageSource{
			Chat:     chat,
			Sender:   sender,
			IsFromMe: isFromMe,
			IsGroup:  chat.Server == types.GroupServer,
		},
		ID:        types.MessageID(pollMessageID),
		Timestamp: time.Unix(0, 0),
	}
	voteMsg, err := a.buildPollVoteLID(a.ctx, pollInfo, selectedOptions)
	if err != nil {
		return fmt.Errorf("failed to build poll vote: %w", err)
	}
	ownJID := canonicalUserJID(a.ctx, a.waClient, a.waClient.Store.GetJID()).String()
	if err := a.messageStore.UpsertPollVote(pollMessageID, ownJID, selectedOptions); err != nil {
		return fmt.Errorf("failed to store vote locally: %w", err)
	}
	a.emitMessageUpdate(chat.String(), pollMessageID)
	if _, err := a.waClient.SendMessage(a.ctx, chat, &waE2E.Message{PollUpdateMessage: voteMsg}); err != nil {
		a.messageStore.DeletePollVote(pollMessageID, ownJID)
		a.emitMessageUpdate(chat.String(), pollMessageID)
		return fmt.Errorf("failed to send poll vote: %w", err)
	}
	return nil
}

func (a *Api) emitMessageUpdate(chatJID, messageID string) {
	updated, err := a.messageStore.GetDecodedMessage(chatJID, messageID)
	if err != nil {
		log.Println("Failed to get decoded message after message update:", err)
		return
	}
	runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
		"chatId":  chatJID,
		"message": updated,
	})
}

// buildPollVoteLID builds a poll vote message using the LID (now the fallback
// to the plain JID if no LID migration has happened) as the modification
// sender. whatsmeow's own BuildPollVote uses the plain JID whenever the poll
// creator is a non-LID user, which breaks decryption on LID-migrated devices
// that see our message sender as our LID. Reactions (which work cross-device)
// always use the LID, so we mirror that here.
func (a *Api) buildPollVoteLID(ctx context.Context, pollInfo *types.MessageInfo, optionNames []string) (*waE2E.PollUpdateMessage, error) {
	plaintext, err := proto.Marshal(&waE2E.PollVoteMessage{
		SelectedOptions: hashPollOptions(optionNames),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal poll vote protobuf: %w", err)
	}
	ownID := a.waClient.Store.GetLID()
	if ownID.IsEmpty() {
		ownID = a.waClient.Store.GetJID()
	}
	baseEncKey, storedOrigSender, err := a.waClient.Store.MsgSecrets.GetMessageSecret(ctx, pollInfo.Chat, pollInfo.Sender, pollInfo.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get original message secret key: %w", err)
	}
	if baseEncKey == nil {
		return nil, whatsmeow.ErrOriginalMessageSecretNotFound
	}
	secretKey, additionalData := generatePollVoteSecretKey(ownID, pollInfo.ID, storedOrigSender, baseEncKey)
	iv := random.Bytes(12)
	ciphertext, err := gcmutil.Encrypt(secretKey, iv, plaintext, additionalData)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt poll vote: %w", err)
	}
	return &waE2E.PollUpdateMessage{
		PollCreationMessageKey: pollCreationMessageKey(pollInfo),
		Vote: &waE2E.PollEncValue{
			EncPayload: ciphertext,
			EncIV:      iv,
		},
		SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
	}, nil
}

// pollOptionHexIndex maps each poll option name to its hex SHA-256 digest,
// the format used in PollVoteMessage hashed selections.
func pollOptionHexIndex(options []string) map[string]string {
	index := make(map[string]string, len(options))
	for _, name := range options {
		h := sha256.Sum256([]byte(name))
		index[hex.EncodeToString(h[:])] = name
	}
	return index
}

func hashPollOptions(optionNames []string) [][]byte {
	optionHashes := make([][]byte, len(optionNames))
	for i, option := range optionNames {
		optionHash := sha256.Sum256([]byte(option))
		optionHashes[i] = optionHash[:]
	}
	return optionHashes
}

func pollCreationMessageKey(msgInfo *types.MessageInfo) *waCommon.MessageKey {
	creationKey := &waCommon.MessageKey{
		RemoteJID: proto.String(msgInfo.Chat.String()),
		FromMe:    proto.Bool(msgInfo.IsFromMe),
		ID:        proto.String(msgInfo.ID),
	}
	if msgInfo.IsGroup {
		creationKey.Participant = proto.String(msgInfo.Sender.String())
	}
	return creationKey
}

// generatePollVoteSecretKey mirrors whatsmeow's generateMsgSecretKey for the
// "Poll Vote" modification type: HKDF-SHA256 over the original message ID,
// original sender, modification sender and use case.
func generatePollVoteSecretKey(modificationSender types.JID, origMsgID types.MessageID, origMsgSender types.JID, origMsgSecret []byte) ([]byte, []byte) {
	const modificationType = "Poll Vote"
	origMsgSenderStr := origMsgSender.ToNonAD().String()
	modificationSenderStr := modificationSender.ToNonAD().String()

	useCaseSecret := make([]byte, 0, len(origMsgID)+len(origMsgSenderStr)+len(modificationSenderStr)+len(modificationType))
	useCaseSecret = append(useCaseSecret, origMsgID...)
	useCaseSecret = append(useCaseSecret, origMsgSenderStr...)
	useCaseSecret = append(useCaseSecret, modificationSenderStr...)
	useCaseSecret = append(useCaseSecret, modificationType...)

	secretKey := hkdfutil.SHA256(origMsgSecret, nil, useCaseSecret, 32)
	additionalData := fmt.Appendf(nil, "%s\x00%s", origMsgID, modificationSenderStr)
	return secretKey, additionalData
}

// SendShareContact shares a contact card in the chat.
func (a *Api) SendShareContact(chatJID, displayName, phone string) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("client not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return "", err
	}
	displayName = strings.TrimSpace(displayName)
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
	if displayName == "" || digits == "" {
		return "", fmt.Errorf("contact needs a name and a phone number")
	}
	vcard := fmt.Sprintf(
		"BEGIN:VCARD\nVERSION:3.0\nFN:%s\nTEL;type=CELL;waid=%s:+%s\nEND:VCARD",
		displayName, digits, digits)
	msg := &waE2E.Message{
		ContactMessage: &waE2E.ContactMessage{
			DisplayName: &displayName,
			Vcard:       &vcard,
		},
	}
	return a.sendAndStoreLocal(chat, msg, "👤 "+displayName)
}
