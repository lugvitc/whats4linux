package api

import (
	"encoding/base64"
	"fmt"
	"log"

	"github.com/lugvitc/whats4linux/internal/markdown"
	"github.com/lugvitc/whats4linux/internal/store"
	mtypes "github.com/lugvitc/whats4linux/internal/types"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type MessageContent struct {
	Type            string   `json:"type"`
	Text            string   `json:"text,omitempty"`
	Base64Data      string   `json:"base64Data,omitempty"`
	QuotedMessageID string   `json:"quotedMessageId,omitempty"`
	Mentions        []string `json:"mentions,omitempty"`
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

func (a *Api) FetchMessagesPaged(jid string, limit int, beforeTimestamp int64) ([]store.DecodedMessage, error) {
	messages, err := a.messageStore.GetDecodedMessagesPaged(jid, beforeTimestamp, limit)
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

func (a *Api) SendMessage(chatJID string, content MessageContent) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("client not logged in")
	}

	parsedJID, err := types.ParseJID(chatJID)
	if err != nil {
		return "", err
	}

	var msgContent *waE2E.Message

	switch content.Type {
	case "text":
		contextInfo, err := a.buildQuotedContext(parsedJID, content.QuotedMessageID)
		if err != nil {
			log.Println("Failed to build quoted context:", err)
			return "", err
		}

		var mentionedJIDs []string
		if len(content.Mentions) > 0 {
			log.Printf("Processing %d mentions: %v", len(content.Mentions), content.Mentions)
			for _, mention := range content.Mentions {
				phoneNumber := ""
				for _, r := range mention {
					if r >= '0' && r <= '9' {
						phoneNumber += string(r)
					}
				}
				if phoneNumber != "" {
					userJID := phoneNumber + "@s.whatsapp.net"
					log.Printf("Converted mention to JID: %s", userJID)
					mentionedJIDs = append(mentionedJIDs, userJID)
				}
			}
		}

		log.Printf("Final mentioned JIDs to send: %v", mentionedJIDs)

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
		mimeType := "image/jpeg"
		imageMsg := &waE2E.ImageMessage{
			Mimetype:      &mimeType,
			Caption:       &content.Text,
			JPEGThumbnail: nil, // We'll let WhatsApp generate the thumbnail
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
		mimeType := "video/mp4"
		videoMsg := &waE2E.VideoMessage{
			Mimetype:      &mimeType,
			Caption:       &content.Text,
			JPEGThumbnail: nil, // We'll let WhatsApp generate the thumbnail
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
		mimeType := "audio/ogg"
		audioMsg := &waE2E.AudioMessage{
			Mimetype: &mimeType,
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
		mimeType := "application/pdf" // Default, should be detected
		fileName := "document.pdf"    // Default, should be provided
		documentMsg := &waE2E.DocumentMessage{
			Mimetype: &mimeType,
			FileName: &fileName,
			Caption:  &content.Text,
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
		mimeType := "image/webp"
		stickerMsg := &waE2E.StickerMessage{
			Mimetype: &mimeType,
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
		"chatId":      parsedJID.String(),
		"message":     msg,
		"messageText": messageText,
		"parsedHTML":  parsedHTML,
		"timestamp":   resp.Timestamp.Unix(),
		"sender":      "You",
	})

	return resp.ID, nil
}
