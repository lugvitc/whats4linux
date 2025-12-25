package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gen2brain/beeep"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/settings"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/nyaruka/phonenumbers"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
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
	Contact
}

type MessageContent struct {
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	Base64Data string `json:"base64Data,omitempty"`
}

// Api struct
type Api struct {
	ctx          context.Context
	cw           *wa.ContainerWrapper
	waClient     *whatsmeow.Client
	messageStore *store.MessageStore
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
	a.cw, err = wa.NewContainerWrapper(ctx, "sqlite3", misc.GetSQLiteAddress("session.wa"), dbLog)
	if err != nil {
		panic(err)
	}
	a.waClient = wa.NewClient(ctx, a.cw.GetContainer())
	a.messageStore, err = store.NewMessageStore()
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
		// load only once
		// TODO: add a global flag system for such things
		// if the initialised is 1 => don't load again else do this
		a.cw.Initialise(a.ctx, a.waClient)
	} else {
		runtime.EventsEmit(a.ctx, "wa:status", "logged_in")
		fmt.Println("Already logged in, connecting...")
		a.cw.Initialise(a.ctx, a.waClient)
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

func (a *Api) FetchMessages(jid string) ([]store.Message, error) {
	parsedJID, err := types.ParseJID(jid)
	if err != nil {
		return nil, err
	}
	messages := a.messageStore.GetMessages(parsedJID)

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

	if msg.Content.ImageMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.ImageMessage)
	} else if msg.Content.VideoMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.VideoMessage)
	} else if msg.Content.AudioMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.AudioMessage)
	} else if msg.Content.DocumentMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.DocumentMessage)
	} else if msg.Content.StickerMessage != nil {
		data, downloadErr = a.waClient.Download(a.ctx, msg.Content.StickerMessage)
	} else {
		return "", fmt.Errorf("no media content found")
	}

	if downloadErr != nil {
		return "", downloadErr
	}

	// Save to Downloads if image, video, document or audio
	if msg.Content.ImageMessage != nil || msg.Content.VideoMessage != nil || msg.Content.DocumentMessage != nil || msg.Content.AudioMessage != nil {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %v", err)
		}
		downloadsDir := filepath.Join(homeDir, "Downloads")

		var fileName string
		if msg.Content.ImageMessage != nil {
			fileName = messageID + ".jpg" // Default to jpg
		} else if msg.Content.VideoMessage != nil {
			fileName = messageID + ".mp4" // Default to mp4
		} else if msg.Content.AudioMessage != nil {
			fileName = messageID + ".ogg" // Default to ogg
		} else if msg.Content.DocumentMessage != nil {
			if msg.Content.DocumentMessage.FileName != nil && *msg.Content.DocumentMessage.FileName != "" {
				fileName = *msg.Content.DocumentMessage.FileName
			} else {
				fileName = messageID + ".bin"
			}
		}

		filePath := filepath.Join(downloadsDir, fileName)

		// Check if file exists
		if _, err := os.Stat(filePath); err == nil {
			// File exists, prompt user to save as
			newPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
				DefaultDirectory: downloadsDir,
				DefaultFilename:  fileName,
				Title:            "File already exists. Save as...",
				Filters: []runtime.FileFilter{
					{
						DisplayName: "Media Files",
						Pattern:     "*" + filepath.Ext(fileName),
					},
				},
			})
			if err != nil {
				return "", err
			}
			if newPath == "" {
				return "", fmt.Errorf("download cancelled")
			}
			filePath = newPath
			fileName = filepath.Base(filePath)
		}

		if err := os.WriteFile(filePath, data, 0644); err != nil {
			return "", fmt.Errorf("failed to save file: %v", err)
		}

		// Send desktop notification with beeep
		beeep.Notify("whats4linux", fmt.Sprintf("Downloaded: %s", filePath), "")
		go func() {
			if _, err := exec.LookPath("mpg123"); err == nil {
				exec.Command("mpg123", "./beep.mp3").Run()
			}
		}()

		// Emit event for frontend listeners as well
		runtime.EventsEmit(a.ctx, "download:complete", fileName)
	}

	return base64.StdEncoding.EncodeToString(data), nil
}

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

		pic, _ := a.waClient.GetProfilePictureInfo(a.ctx, cm.JID, &whatsmeow.GetProfilePictureParams{
			Preview: true,
		})
		if pic != nil {
			fc.AvatarURL = pic.URL
		}

		ce[i] = ChatElement{
			LatestMessage: cm.MessageText,
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
		msgContent = &waE2E.Message{
			Conversation: &content.Text,
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
	a.messageStore.ProcessMessageEvent(&events.Message{
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
	})
	runtime.EventsEmit(a.ctx, "wa:new_message")

	return resp.ID, nil
}

func (a *Api) mainEventHandler(evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		a.messageStore.ProcessMessageEvent(v)
		runtime.EventsEmit(a.ctx, "wa:new_message")
	default:
		// Ignore other events for now
	}

}
