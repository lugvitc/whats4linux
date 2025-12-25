package api

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/lugvitc/whats4linux/internal/mstore"
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

// Api struct
type Api struct {
	ctx          context.Context
	cw           *wa.ContainerWrapper
	waClient     *whatsmeow.Client
	messageStore *mstore.MessageStore
}

// NewApi creates a new Api application struct
func New() *Api {
	return &Api{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *Api) Startup(ctx context.Context) {
	a.ctx = ctx
	dbLog := waLog.Stdout("Database", "ERROR", true)
	var err error
	a.cw, err = wa.NewContainerWrapper(ctx, "sqlite3", "file:wa.db?_foreign_keys=on", dbLog)
	if err != nil {
		panic(err)
	}
	a.waClient = wa.NewClient(ctx, a.cw.GetContainer())
	a.messageStore = mstore.NewMessageStore()
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

func (a *Api) FetchMessages(jid string) ([]mstore.Message, error) {
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

func (a *Api) GetProfile() (Contact, error) {

	me := *a.waClient.Store.ID

	contact, _ := a.waClient.Store.Contacts.GetContact(a.ctx, me)
	rawNum := "+" + me.User

	jid := rawNum
	num, err := phonenumbers.Parse(rawNum, "")
	if err == nil && phonenumbers.IsValidNumber(num) {
		jid = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
	}

	pic, _ := a.waClient.GetProfilePictureInfo(a.ctx, me, &whatsmeow.GetProfilePictureParams{
		Preview: true,
	})
	var avatarURL string
	if pic != nil {
		avatarURL = pic.URL
	}

	return Contact{
		JID:        jid,
		FullName:   contact.FullName,
		Short:      contact.FirstName,
		PushName:   a.waClient.Store.PushName,
		IsBusiness: contact.BusinessName != "",
		AvatarURL:  avatarURL,
	}, nil
func (a *Api) SendMessage(chatJID string, message string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("client not logged in")
	}

	parsedJID, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}

	msgContent := &waE2E.Message{
		Conversation: &message,
	}

	resp, err := a.waClient.SendMessage(a.ctx, parsedJID, msgContent)
	if err != nil {
		return err
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

	return nil
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
