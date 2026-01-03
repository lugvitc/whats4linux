package api

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gen2brain/beeep"
	"github.com/lugvitc/whats4linux/internal/cache"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/settings"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/nyaruka/phonenumbers"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type Contact struct {
	JID        string `json:"jid"`
	Short      string `json:"short"`
	FullName   string `json:"full_name"`
	PushName   string `json:"push_name"`
	IsBusiness bool   `json:"is_business"`
	AvatarURL  string `json:"avatar_url"`
}

type ChatElement struct {
	LatestMessage string `json:"latest_message"`
	LatestTS      int64
	Contact
}

type MessageContent struct {
	Type            string `json:"type"`
	Text            string `json:"text,omitempty"`
	Base64Data      string `json:"base64Data,omitempty"`
	QuotedMessageID string `json:"quotedMessageId,omitempty"`
}

// Api struct
type Api struct {
	ctx          context.Context
	cw           *wa.AppDatabase
	waClient     *whatsmeow.Client
	messageStore *store.MessageStore
	imageCache   *cache.ImageCache
}

// NewApi creates a new Api application struct
func New() *Api {
	return &Api{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *Api) Startup(ctx context.Context) {
	a.ctx = ctx
	dbLog := waLog.Stdout("Database", settings.GetLogLevel(), true)
	var err error
	a.cw, err = wa.NewAppDatabase(ctx)
	if err != nil {
		panic(err)
	}
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("session.wa"))
	if err != nil {
		panic(err)
	}
	container := sqlstore.NewWithDB(db, "sqlite3", dbLog)
	err = container.Upgrade(ctx)
	if err != nil {
		panic(err)
	}
	a.waClient = wa.NewClient(ctx, container)
	a.messageStore, err = store.NewMessageStore()
	if err != nil {
		panic(err)
	}
	a.imageCache, err = cache.NewImageCache()
	if err != nil {
		panic(err)
	}
}

func (a *Api) Login() error {
	var err error
	a.waClient.AddEventHandler(a.mainEventHandler)
	if a.waClient.Store.ID == nil {
		qrChan, _ := a.waClient.GetQRChannel(a.ctx)
		err = a.waClient.Connect()
		if err != nil {
			return err
		}
		for evt := range qrChan {
			if evt.Event == "code" {
				runtime.EventsEmit(a.ctx, "wa:qr", evt.Code)
			} else {
				runtime.EventsEmit(a.ctx, "wa:status", evt.Event)
			}
		}
	} else {
		runtime.EventsEmit(a.ctx, "wa:status", "logged_in")
		// Already logged in, just connect
		err = a.waClient.Connect()
		if err != nil {
			return err
		}
	}
	return nil
}

func (a *Api) FetchGroups() ([]wa.Group, error) {
	groups, err := a.waClient.GetJoinedGroups(a.ctx)
	if err != nil {
		return nil, err
	}

	var result []wa.Group
	for _, g := range groups {
		result = append(result, wa.Group{
			JID:              g.JID.String(),
			Name:             g.Name,
			Topic:            g.Topic,
			OwnerJID:         g.OwnerJID.String(),
			ParticipantCount: len(g.Participants),
		})
	}
	return result, nil
}

func (a *Api) GetContact(jid types.JID) (*Contact, error) {
	contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, jid)
	if err != nil {
		return nil, err
	}
	rawNum := "+" + jid.User
	// Parse phone number to use as International Format
	num, err := phonenumbers.Parse(rawNum, "")
	if err != nil && !phonenumbers.IsValidNumber(num) {
		return nil, fmt.Errorf("invalid phone number")
	}

	return &Contact{
		JID:        phonenumbers.Format(num, phonenumbers.INTERNATIONAL),
		FullName:   contact.FullName,
		Short:      contact.FirstName,
		PushName:   contact.PushName,
		IsBusiness: contact.BusinessName != "",
	}, nil
}

func (a *Api) FetchContacts() ([]Contact, error) {
	rawContacts, err := a.waClient.Store.Contacts.GetAllContacts(a.ctx)
	if err != nil {
		return nil, err
	}
	contacts := make([]Contact, 0, len(rawContacts))

	var result []Contact
	for jid, c := range rawContacts {
		rawNum := "+" + jid.User
		// Parse phone number to use as International Format
		num, err := phonenumbers.Parse(rawNum, "")
		if err != nil && !phonenumbers.IsValidNumber(num) {
			continue
		}

		contacts = append(contacts, Contact{
			JID:        phonenumbers.Format(num, phonenumbers.INTERNATIONAL),
			FullName:   c.FullName,
			Short:      c.FirstName,
			PushName:   c.PushName,
			IsBusiness: c.BusinessName != "",
		})
	}
	return result, nil
}

func (a *Api) FetchMessagesPaged(jid string, limit int, beforeTimestamp int64) ([]store.Message, error) {
	parsedJID, err := types.ParseJID(jid)
	if err != nil {
		return nil, err
	}
	messages := a.messageStore.GetMessagesPaged(parsedJID, beforeTimestamp, limit)
	return messages, nil
}

func (a *Api) DownloadMedia(chatJID string, messageID string) (string, error) {
	parsedJID, err := types.ParseJID(chatJID)
	if err != nil {
		return "", err
	}
	msg := a.messageStore.GetMessage(parsedJID, messageID)
	if msg == nil {
		return "", fmt.Errorf("message not found")
	}

	var data []byte
	var downloadErr error
	var mime string
	var width, height int

	if msg.Content.ImageMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.ImageMessage)
		mime = msg.Content.ImageMessage.GetMimetype()
		if mime == "" {
			mime = "image/jpeg"
		}
		width = int(msg.Content.ImageMessage.GetWidth())
		height = int(msg.Content.ImageMessage.GetHeight())
	} else if msg.Content.VideoMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.VideoMessage)
		mime = msg.Content.VideoMessage.GetMimetype()
	} else if msg.Content.AudioMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.AudioMessage)
		mime = msg.Content.AudioMessage.GetMimetype()
	} else if msg.Content.DocumentMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.DocumentMessage)
		mime = msg.Content.DocumentMessage.GetMimetype()
	} else if msg.Content.StickerMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.StickerMessage)
		mime = msg.Content.StickerMessage.GetMimetype()
		if mime == "" {
			mime = "image/webp"
		}
		width = int(msg.Content.StickerMessage.GetWidth())
		height = int(msg.Content.StickerMessage.GetHeight())
	} else {
		return "", fmt.Errorf("no media content found")
	}

	if downloadErr != nil {
		return "", downloadErr
	}

	// Save to cache for images and stickers
	if msg.Content.ImageMessage != nil || msg.Content.StickerMessage != nil {
		_, err = a.imageCache.SaveImage(messageID, data, mime, width, height)
		if err != nil {
			// Log error but continue
		}
	}

	return base64.StdEncoding.EncodeToString(data), nil
}

var tmpProfileCache = misc.NewVMap[string, string]()

func (a *Api) GetChatList() ([]ChatElement, error) {
	cmList := a.messageStore.GetChatList()
	ce := make([]ChatElement, len(cmList))
	for i, cm := range cmList {
		var fc Contact
		if cm.JID.Server == types.GroupServer {
			groupInfo, err := a.cw.FetchGroup(cm.JID.String())
			if err != nil {
				return nil, err
			}
			fc = Contact{
				JID:      cm.JID.String(),
				FullName: groupInfo.Name,
			}
		} else {
			contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, cm.JID)
			if err != nil {
				return nil, err
			}
			fc = Contact{
				JID:        cm.JID.String(),
				Short:      contact.FirstName,
				FullName:   contact.FullName,
				PushName:   contact.PushName,
				IsBusiness: contact.BusinessName != "",
			}
		}

		// Get cached avatar for all chats (both groups and contacts)
		// Avatar loading is now handled asynchronously on the frontend
		// log.Printf("Fetching avatar for: %s (server: %s)", cm.JID.String(), cm.JID.Server)
		// if avatarURL, err := a.GetCachedAvatar(cm.JID.String()); err == nil && avatarURL != "" {
		// 	fc.AvatarURL = avatarURL
		// } else {
		// 	log.Printf("FAILED: No avatar found for %s: %v", cm.JID.String(), err)
		// }

		// todo: remove this later
		fc.FullName = fmt.Sprintf("%s (%s)", fc.FullName, cm.JID.String())
		ce[i] = ChatElement{
			LatestMessage: cm.MessageText,
			LatestTS:      cm.MessageTime,
			Contact:       fc,
		}
	}
	return ce, nil
}

func (a *Api) GetProfile(jidStr string) (Contact, error) {
	var targetJID types.JID
	if jidStr == "" {
		if a.waClient.Store.ID == nil {
			return Contact{}, fmt.Errorf("not logged in")
		}
		targetJID = *a.waClient.Store.ID
	} else {
		var err error
		targetJID, err = types.ParseJID(jidStr)
		if err != nil {
			return Contact{}, fmt.Errorf("invalid JID: %w", err)
		}
	}

	contact, _ := a.waClient.Store.Contacts.GetContact(a.ctx, targetJID)
	rawNum := "+" + targetJID.User

	jid := rawNum
	num, err := phonenumbers.Parse(rawNum, "")
	if err == nil && phonenumbers.IsValidNumber(num) {
		jid = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
	}

	pic, _ := a.waClient.GetProfilePictureInfo(a.ctx, targetJID, &whatsmeow.GetProfilePictureParams{
		Preview: true,
	})
	var avatarURL string
	if pic != nil {
		avatarURL = pic.URL
	}

	pushName := contact.PushName
	// If it's self, try to get pushname from store if contact pushname is empty
	if jidStr == "" && a.waClient.Store.PushName != "" {
		pushName = a.waClient.Store.PushName
	}

	return Contact{
		JID:        jid,
		FullName:   contact.FullName,
		Short:      contact.FirstName,
		PushName:   pushName,
		IsBusiness: contact.BusinessName != "",
		AvatarURL:  avatarURL,
	}, nil
}

func (a *Api) buildQuotedContext(chatJID types.JID, quotedMessageID string) (*waE2E.ContextInfo, error) {
	if quotedMessageID == "" {
		return nil, nil
	}

	quotedMsg := a.messageStore.GetMessage(chatJID, quotedMessageID)
	if quotedMsg == nil || quotedMsg.Content == nil {
		return nil, fmt.Errorf("quoted message not found")
	}

	stanzaID := quotedMsg.Info.ID
	contextInfo := &waE2E.ContextInfo{
		StanzaID:      &stanzaID,
		QuotedMessage: quotedMsg.Content,
	}

	if quotedMsg.Info.Sender.User != "" {
		participant := quotedMsg.Info.Sender.String()
		contextInfo.Participant = &participant
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
			return "", err
		}

		if contextInfo != nil {
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

	resp, err := a.waClient.SendMessage(a.ctx, parsedJID, msgContent)
	if err != nil {
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
	a.messageStore.ProcessMessageEvent(msgEvent)

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

	msg := store.Message{
		Info:    msgEvent.Info,
		Content: msgEvent.Message,
	}
	runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
		"chatId":      parsedJID.String(),
		"message":     msg,
		"messageText": messageText,
		"timestamp":   resp.Timestamp.Unix(),
	})

	return resp.ID, nil
}

func (a *Api) mainEventHandler(evt any) {
	switch v := evt.(type) {
	case *events.Message:
		a.messageStore.ProcessMessageEvent(v)

		// Automatically cache images and stickers when they arrive
		go func() {
			if v.Message.GetImageMessage() != nil || v.Message.GetStickerMessage() != nil {
				var data []byte
				var err error
				var mime string
				var width, height int

				if v.Message.GetImageMessage() != nil {
					data, err = a.waClient.Download(a.ctx, v.Message.GetImageMessage())
					if err == nil {
						mime = v.Message.GetImageMessage().GetMimetype()
						if mime == "" {
							mime = "image/jpeg"
						}
						width = int(v.Message.GetImageMessage().GetWidth())
						height = int(v.Message.GetImageMessage().GetHeight())
					}
				} else if v.Message.GetStickerMessage() != nil {
					data, err = a.waClient.Download(a.ctx, v.Message.GetStickerMessage())
					if err == nil {
						mime = v.Message.GetStickerMessage().GetMimetype()
						if mime == "" {
							mime = "image/webp"
						}
						width = int(v.Message.GetStickerMessage().GetWidth())
						height = int(v.Message.GetStickerMessage().GetHeight())
					}
				}

				if err == nil && data != nil {
					_, cacheErr := a.imageCache.SaveImage(v.Info.ID, data, mime, width, height)
					if cacheErr != nil {
					} else {
					}
				}
			}
		}()

		// Emit the message data directly so frontend doesn't need to make an API call
		// Extract message text for chat list update
		var messageText string
		if v.Message.GetConversation() != "" {
			messageText = v.Message.GetConversation()
		} else if v.Message.GetExtendedTextMessage() != nil {
			messageText = v.Message.GetExtendedTextMessage().GetText()
		} else {
			switch {
			case v.Message.GetImageMessage() != nil:
				messageText = "image"
			case v.Message.GetVideoMessage() != nil:
				messageText = "video"
			case v.Message.GetAudioMessage() != nil:
				messageText = "audio"
			case v.Message.GetDocumentMessage() != nil:
				messageText = "document"
			case v.Message.GetStickerMessage() != nil:
				messageText = "sticker"
			default:
				messageText = "message"
			}
		}

		msg := store.Message{
			Info:    v.Info,
			Content: v.Message,
		}
		runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
			"chatId":      v.Info.Chat.String(),
			"message":     msg,
			"messageText": messageText,
			"timestamp":   v.Info.Timestamp.Unix(),
		})
	case *events.Connected:
		// For new logins, there might be a problem where the whatsmeow client
		// gets a 515 code which gets resolved internally by auto-reconnecting
		// in a separate goroutine. In that case, the Initialise call below for
		// the AppDatabase will be executed first without the client even logging
		// in (which is the reason why the groups fetch fails and there are no
		// groups in the app until a manual reinitialize is done). To avoid that,
		// wait here until logged in.
		a.cw.Initialise(a.waClient)
		a.waClient.SendPresence(a.ctx, types.PresenceAvailable)
	case *events.Disconnected:
		a.waClient.SendPresence(a.ctx, types.PresenceUnavailable)

	default:
		// Ignore other events for now
	}

}

func (a *Api) GetCustomCSS() string {
	return settings.GetCustomCSS()
}

func (a *Api) SetCustomCSS(css string) error {
	return settings.SetCustomCSS(css)
}

func (a *Api) GetCustomJS() string {
	return settings.GetCustomJS()
}

func (a *Api) SetCustomJS(js string) error {
	return settings.SetCustomJS(js)
}

func (a *Api) Reinitialize() error {
	return a.cw.Initialise(a.waClient)
}

func (a *Api) SendChatPresence(jid string, cp types.ChatPresence, cpm types.ChatPresenceMedia) error {
	parsedJid, err := types.ParseJID(jid)
	if err != nil {
		return err
	}
	return a.waClient.SendChatPresence(a.ctx, parsedJid, cp, cpm)
}

func (a *Api) SaveSettings(s map[string]any) {
	store.SaveSettings(s)
}

func (a *Api) GetSettings() map[string]any {
	return store.GetSettings()
}

// downloadMedia downloads media from a message and returns data, mime, width, height
func (a *Api) downloadMedia(msg *store.Message) ([]byte, string, int, int, error) {
	var data []byte
	var err error
	var mime string
	var width, height int

	if msg.Content.ImageMessage != nil {
		data, err = a.waClient.Download(a.ctx, msg.Content.ImageMessage)
		mime = msg.Content.ImageMessage.GetMimetype()
		if mime == "" {
			mime = "image/jpeg"
		}
		width = int(msg.Content.ImageMessage.GetWidth())
		height = int(msg.Content.ImageMessage.GetHeight())
	} else if msg.Content.StickerMessage != nil {
		data, err = a.waClient.Download(a.ctx, msg.Content.StickerMessage)
		mime = msg.Content.StickerMessage.GetMimetype()
		if mime == "" {
			mime = "image/webp"
		}
		width = int(msg.Content.StickerMessage.GetWidth())
		height = int(msg.Content.StickerMessage.GetHeight())
	} else {
		return nil, "", 0, 0, fmt.Errorf("message is not an image or sticker")
	}

	return data, mime, width, height, err
}

func (a *Api) GetCachedImage(messageID string) (string, error) {
	// Try to read from cache first
	data, mime, err := a.imageCache.ReadImageByMessageID(messageID)
	if err == nil {
		return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)), nil
	}

	// Image not in cache, download and cache it
	msg := a.messageStore.GetMessageByID(messageID)
	if msg == nil {
		return "", fmt.Errorf("message not found")
	}

	data, mime, width, height, err := a.downloadMedia(msg)
	if err != nil {
		return "", fmt.Errorf("failed to download image: %w", err)
	}

	_, err = a.imageCache.SaveImage(messageID, data, mime, width, height)
	if err != nil {
		// Don't fail, still return the data
	}

	return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)), nil
}

// GetCachedImages retrieves multiple cached images by message IDs (batch operation)
// Returns map of message IDs to data URLs
func (a *Api) GetCachedImages(messageIDs []string) (map[string]string, error) {
	result := make(map[string]string)
	metas, err := a.imageCache.GetImagesByMessageIDs(messageIDs)
	if err != nil {
		return nil, err
	}

	for msgID, meta := range metas {
		if meta != nil {
			data, mime, err := a.imageCache.ReadImageByMessageID(msgID)
			if err == nil {
				result[msgID] = fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
			}
		}
	}

	return result, nil
}

// GetCachedAvatar retrieves or downloads and caches an avatar for a JID
func (a *Api) GetCachedAvatar(jid string) (string, error) {

	// Try to get cached avatar data first
	data, mime, err := a.imageCache.ReadAvatarByJID(jid)
	if err == nil {
		avatarDataURL := fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
		return avatarDataURL, nil
	}

	// Avatar not in cache, download and cache it
	jidParsed, err := types.ParseJID(jid)
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	// Get profile picture info
	pic, err := a.waClient.GetProfilePictureInfo(a.ctx, jidParsed, &whatsmeow.GetProfilePictureParams{
		Preview: false, // Get full resolution
	})
	if err != nil || pic == nil {
		return "", nil // No avatar available
	}

	// Download the avatar using standard HTTP since profile picture URLs are public
	resp, err := http.Get(pic.URL)
	if err != nil {
		return "", fmt.Errorf("failed to download avatar: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download avatar: status %d", resp.StatusCode)
	}

	// Read the image data
	data, err = io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read avatar data: %w", err)
	}

	// Determine MIME type from response header or image data
	mime = resp.Header.Get("Content-Type")
	if mime == "" {
		// Fallback to detection by file signature
		mime = "image/jpeg" // Default fallback
		if len(data) > 3 {
			switch {
			case data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47:
				mime = "image/png"
			case data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46:
				mime = "image/gif"
			case data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46:
				mime = "image/webp"
			}
		}
	}

	// Cache the avatar
	_, err = a.imageCache.SaveAvatar(jid, data, mime)
	if err != nil {
		log.Printf("[GetCachedAvatar] Failed to cache avatar for %s: %v", jid, err)
		return "", fmt.Errorf("failed to cache avatar: %w", err)
	}

	// Return data URL like message images do
	avatarDataURL := fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
	return avatarDataURL, nil
}

// getFileExtension returns file extension for mime type
func getFileExtension(mime string) string {
	switch mime {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	default:
		return ".jpg"
	}
}

// DownloadImageToFile downloads an image from cache to the Downloads folder
func (a *Api) DownloadImageToFile(messageID string) error {
	data, mime, err := a.imageCache.ReadImageByMessageID(messageID)
	if err != nil {
		return err
	}

	downloadsDir := filepath.Join(os.Getenv("HOME"), "Downloads")
	fileName := messageID + getFileExtension(mime)
	filePath := filepath.Join(downloadsDir, fileName)

	// Check if file exists and prompt for new path
	if _, err := os.Stat(filePath); err == nil {
		if filePath, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			DefaultDirectory: downloadsDir,
			DefaultFilename:  fileName,
			Title:            "File already exists. Save as...",
			Filters:          []runtime.FileFilter{{DisplayName: "Image Files", Pattern: "*" + getFileExtension(mime)}},
		}); err != nil || filePath == "" {
			return err
		}
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return err
	}

	beeep.Notify("whats4linux", "Downloaded: "+filePath, "")
	go func() {
		if _, err := exec.LookPath("mpg123"); err == nil {
			exec.Command("mpg123", "./beep.mp3").Run()
		}
	}()
	return nil
}
