package api

import (
	"context"
	"database/sql"
	"errors"
	"log"

	"github.com/lugvitc/whats4linux/internal/cache"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/settings"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/lugvitc/whats4linux/shared/socket"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Api struct
type Api struct {
	ctx          context.Context
	cw           *wa.AppDatabase
	waClient     *whatsmeow.Client
	messageStore *store.MessageStore
	imageCache   *cache.ImageCache
	us           *socket.UnixSocket
}

// NewApi creates a new Api application struct
func New() *Api {
	return &Api{}
}

func (a *Api) OnSecondInstanceLaunch(secondInstanceData options.SecondInstanceData) {
	runtime.WindowUnminimise(a.ctx)
	runtime.Show(a.ctx)
}

func (a *Api) Shutdown(ctx context.Context) {
	_ = a.us.SendCommand("shutdown")
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *Api) Startup(ctx context.Context) {
	var err error
	a.us, err = socket.NewUnixSocket(ctx)
	if err != nil {
		panic(err)
	}
	go func() {
		err := a.us.ListenAndServe()
		if err != nil {
			log.Println("Unix socket server error:", err)
		}
	}()

	err = misc.StartSystray()
	if err != nil {
		log.Printf("failed to start systray: %v", err)
	}

	a.ctx = ctx
	dbLog := waLog.Stdout("Database", settings.GetLogLevel(), true)
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

func (a *Api) mainEventHandler(evt any) {
	switch v := evt.(type) {
	case *events.Message:

		parsedHTML := a.processMessageText(v.Message)

		// Handle message edits: re-parse the edited content
		if protoMsg := v.Message.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
			newContent := protoMsg.GetEditedMessage()
			if newContent != nil {
				parsedHTML = a.processMessageText(newContent)
			}
		}

		messageID := a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, v, parsedHTML)

		// If a message was processed (inserted or updated), emit the decoded message from DB
		if messageID != "" {
			updatedMsg, err := a.messageStore.GetDecodedMessage(v.Info.Chat.String(), messageID)
			if err == nil {
				runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
					"chatId":      v.Info.Chat.String(),
					"message":     updatedMsg,
					"messageText": parsedHTML, // Text field contains HTML now, but better than nothing or we can use updatedMsg.Text
					"timestamp":   v.Info.Timestamp.Unix(),
					"sender":      v.Info.PushName,
				})
			} else if !errors.Is(err, sql.ErrNoRows) {
				log.Println("Failed to get decoded message after processing:", err)
			}
		}

		if reaction := v.Message.GetReactionMessage(); reaction != nil {
			go func() {
				targetID := reaction.GetKey().GetID()
				targetMsg, err := a.messageStore.GetMessageWithMedia(v.Info.Chat.String(), targetID)
				if err != nil {
					log.Println("Failed", err)
					return
				}

				targetText := targetMsg.Text
				senderName := v.Info.PushName
				if senderName == "" && v.Info.Sender.User != "" {
					senderName = v.Info.Sender.User
				}
				if v.Info.IsFromMe {
					senderName = "You"
				}

				runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
					"chatId":      v.Info.Chat.String(),
					"message":     nil,
					"messageText": targetText,
					"reaction":    reaction.GetText(),
					"timestamp":   v.Info.Timestamp.Unix(),
					"sender":      senderName,
				})
			}()
		}

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

	case *events.Picture:
		go a.GetCachedAvatar(v.JID.String(), true)

		runtime.EventsEmit(a.ctx, "wa:picture_update", v.JID.String())

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
		// Run migration for messages.db
		err := a.messageStore.MigrateLIDToPN(a.ctx, a.waClient.Store.LIDs)
		if err != nil {
			log.Println("Messages DB migration failed:", err)
		} else {
			log.Println("Messages DB migration completed successfully")
			runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
		}
	case *events.Disconnected:
		a.waClient.SendPresence(a.ctx, types.PresenceUnavailable)
	case *events.Receipt:
		runtime.EventsEmit(a.ctx, "wa:message_receipt", map[string]any{
			"chatId": v.Chat.String(),
			"status": v.Type.GoString(),
		})
	default:
		// Ignore other events for now
	}

}
