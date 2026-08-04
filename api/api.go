package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/gen2brain/beeep"

	"github.com/lugvitc/whats4linux/internal/cache"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/settings"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/lugvitc/whats4linux/shared/socket"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Api struct
type Api struct {
	ctx                 context.Context
	cw                  *wa.AppDatabase
	waClient            *whatsmeow.Client
	messageStore        *store.MessageStore
	imageCache          *cache.ImageCache
	us                  *socket.UnixSocket
	waContainer         *sqlstore.Container
	eventHandlerID      uint32
	eventHandlerSet     bool
	startupErr          error
	loginCancel         context.CancelFunc
	lifecycleMu         sync.Mutex
	loginMu             sync.Mutex
	eventMu             sync.RWMutex
	taskMu              sync.Mutex
	backgroundTasks     sync.WaitGroup
	shuttingDown        bool
	windowFocused       atomic.Bool
	groupRepairInFlight atomic.Bool
	appStateResync      atomic.Bool
	// appStateRecoveryReq tracks which collections we've already asked the
	// phone to re-send (keyed by appstate.WAPatchName). See
	// requestAppStateRecovery.
	appStateRecoveryReq sync.Map
}

// repairGroupNames heals whats4linux_groups rows that are missing or were
// stored with an empty name during early history sync. It runs in the
// background after the client connects (never on the GetChatList hot path,
// which must stay local-only and instant) and tells the frontend to reload
// the chat list once anything was fixed.
func (a *Api) repairGroupNames() {
	if !a.groupRepairInFlight.CompareAndSwap(false, true) {
		return
	}
	defer a.groupRepairInFlight.Store(false)

	repaired := 0
	for _, cm := range a.messageStore.GetChatList() {
		if cm.JID.Server != types.GroupServer {
			continue
		}
		if g, err := a.cw.FetchGroup(cm.JID.String()); err == nil && g.Name != "" {
			continue
		}
		gi, err := a.waClient.GetGroupInfo(a.ctx, cm.JID)
		if err != nil || gi == nil || gi.GroupName.Name == "" {
			continue
		}
		parentJID := ""
		if !gi.LinkedParentJID.IsEmpty() {
			parentJID = gi.LinkedParentJID.String()
		}
		if err := a.cw.StoreGroup(wa.Group{
			JID:              cm.JID.String(),
			Name:             gi.GroupName.Name,
			Topic:            gi.GroupTopic.Topic,
			OwnerJID:         gi.OwnerJID.String(),
			ParticipantCount: len(gi.Participants),
			ParentJID:        parentJID,
			ParentName:       a.cw.ParentCommunityName(parentJID),
			IsParent:         gi.IsParent,
			IsDefaultSub:     gi.IsDefaultSubGroup,
		}); err != nil {
			log.Println("repairGroupNames: failed to persist group:", cm.JID.String(), err)
			continue
		}
		repaired++
	}

	if repaired > 0 {
		log.Printf("repairGroupNames: repaired %d group name(s)", repaired)
		runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
	}
}

// resyncAppState fully syncs the archive/pin and mute app state collections.
// Called when sending a mutation failed, on the theory that our local view has
// drifted from the server's. Not called on connect: whatsmeow already fetches
// incrementally there, and a full sync is destructive (see below).
func (a *Api) resyncAppState() {
	if !a.appStateResync.CompareAndSwap(false, true) {
		return
	}
	defer a.appStateResync.Store(false)

	// regular_low carries archive/pin mutations, regular_high carries mutes.
	// FetchAppState with fullSync=true resets the local version itself and
	// re-applies the collection from a server snapshot; with
	// EmitAppStateEventsOnFullSync set, every mutation is dispatched to
	// mainEventHandler (FromFullSync=true) and lands in our tables.
	for _, name := range []appstate.WAPatchName{appstate.WAPatchRegularLow, appstate.WAPatchRegularHigh} {
		// Never full-sync a collection we've asked the phone to re-send: the
		// server snapshot is the thing that fails to verify, so this would drop
		// the recovered version and re-fetch the same broken data.
		if _, recovering := a.appStateRecoveryReq.Load(name); recovering {
			log.Println("Skipping app state full sync, recovery pending:", name)
			continue
		}
		if err := a.waClient.FetchAppState(a.ctx, name, true, false); err != nil {
			log.Printf("App state full sync failed for %s: %v", name, err)
			continue
		}
		log.Println("App state fully synced:", name)
	}
	runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
}

// requestAppStateRecovery asks the phone for an unencrypted copy of an app
// state collection. This is the escape hatch for a hash chain that a full sync
// cannot repair: when the server snapshot itself fails LTHash verification,
// resyncAppState re-downloads that same unverifiable snapshot on every connect
// and the collection stays pinned at its last good version forever, so
// archive/pin/mute changes made on the phone stop arriving.
//
// The phone replies with a snapshot whatsmeow applies without LTHash
// verification, dispatching each mutation as a normal event (whats4linux sets
// EmitAppStateEventsOnFullSync, see internal/wa/client.go) so it lands in our
// tables through the events.Archive/events.Pin handlers.
//
// Asked at most once per collection per run: the reply is asynchronous and
// arrives well after the sync error that triggered it, so re-requesting on
// every failed fetch would send the phone a burst of duplicate requests.
func (a *Api) requestAppStateRecovery(name appstate.WAPatchName) {
	if _, asked := a.appStateRecoveryReq.LoadOrStore(name, true); asked {
		return
	}
	if _, err := a.waClient.SendPeerMessage(a.ctx, whatsmeow.BuildAppStateRecoveryRequest(name)); err != nil {
		// Let a later failure try again — the request never reached the phone.
		a.appStateRecoveryReq.Delete(name)
		log.Printf("App state recovery request failed for %s: %v", name, err)
		return
	}
	log.Println("Requested app state recovery from phone:", name)
}

// htmlTagRE strips HTML tags from message previews so desktop notifications
// show plain text rather than markup.
var htmlTagRE = regexp.MustCompile(`<[^>]*>`)

// SetWindowFocused is called by the frontend on window focus/blur so the
// backend only raises notifications while the window is in the background.
func (a *Api) SetWindowFocused(focused bool) {
	a.windowFocused.Store(focused)
}

// notifyIncoming raises a desktop notification for an incoming message when the
// window isn't focused.
func (a *Api) notifyIncoming(v *events.Message, parsedHTML string) {
	title := v.Info.PushName
	if title == "" {
		title = "New message"
	}
	body := strings.TrimSpace(htmlTagRE.ReplaceAllString(parsedHTML, ""))
	if body == "" {
		body = "Sent you a message"
	}
	if err := beeep.Notify(title, body, ""); err != nil {
		log.Println("notify failed:", err)
	}
}

// NewApi creates a new Api application struct
func New() *Api {
	return &Api{}
}

func (a *Api) startBackground(task func()) bool {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	if a.shuttingDown {
		return false
	}
	a.backgroundTasks.Add(1)
	go func() {
		defer a.backgroundTasks.Done()
		task()
	}()
	return true
}

func (a *Api) isShuttingDown() bool {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	return a.shuttingDown
}

func (a *Api) OnSecondInstanceLaunch(secondInstanceData options.SecondInstanceData) {
	runtime.WindowUnminimise(a.ctx)
	runtime.Show(a.ctx)
}

func (a *Api) Shutdown(ctx context.Context) {
	a.taskMu.Lock()
	a.shuttingDown = true
	a.taskMu.Unlock()

	a.lifecycleMu.Lock()
	client := a.waClient
	loginCancel := a.loginCancel
	if client != nil && a.eventHandlerSet {
		client.RemoveEventHandler(a.eventHandlerID)
		a.eventHandlerSet = false
	}
	a.lifecycleMu.Unlock()

	if loginCancel != nil {
		loginCancel()
	}
	if client != nil {
		client.Disconnect()
	}
	// Login may be waiting on the QR channel or finishing Connect. Cancellation
	// releases the QR wait; the second disconnect catches a Connect that raced
	// with shutdown after the first disconnect.
	a.loginMu.Lock()
	a.loginMu.Unlock()
	if client != nil {
		client.Disconnect()
	}
	// Wait for an event that entered before RemoveEventHandler and every
	// background task it launched before closing their stores.
	a.eventMu.Lock()
	a.eventMu.Unlock()
	a.backgroundTasks.Wait()

	if err := a.closeResources(); err != nil {
		log.Println("shutdown cleanup failed:", err)
	}
}

func (a *Api) closeResources() error {
	var closeErr error
	if a.us != nil {
		_ = a.us.SendCommand("shutdown")
		closeErr = errors.Join(closeErr, a.us.Close())
		a.us = nil
	}
	if a.messageStore != nil {
		closeErr = errors.Join(closeErr, a.messageStore.Close())
		a.messageStore = nil
	}
	if a.imageCache != nil {
		closeErr = errors.Join(closeErr, a.imageCache.Close())
		a.imageCache = nil
	}
	if a.cw != nil {
		closeErr = errors.Join(closeErr, a.cw.Close())
		a.cw = nil
	}
	if a.waContainer != nil {
		closeErr = errors.Join(closeErr, a.waContainer.Close())
		a.waContainer = nil
	}
	return closeErr
}

func (a *Api) failStartup(err error) {
	a.lifecycleMu.Lock()
	a.startupErr = err
	a.lifecycleMu.Unlock()
	log.Println("startup failed:", err)
	if closeErr := a.closeResources(); closeErr != nil {
		log.Println("startup cleanup failed:", closeErr)
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *Api) Startup(ctx context.Context) {
	// The window is focused when the app launches; the frontend keeps this in
	// sync via SetWindowFocused so we don't notify while the user is looking.
	a.windowFocused.Store(true)
	// Set the context before anything that may call back into the Api (the
	// systray command handler needs it for EventsEmit).
	a.ctx = ctx
	var err error
	a.us, err = socket.NewUnixSocket(ctx)
	if err != nil {
		a.failStartup(fmt.Errorf("create tray socket: %w", err))
		return
	}
	a.us.SetCommandHandler(a.trayCommandHandler)
	socketServer := a.us
	go func() {
		err := socketServer.ListenAndServe()
		if err != nil {
			log.Println("Unix socket server error:", err)
		}
	}()

	err = misc.StartSystray()
	if err != nil {
		log.Printf("failed to start systray: %v", err)
	}

	dbLog := waLog.Stdout("Database", settings.GetLogLevel(), true)
	a.cw, err = wa.NewAppDatabase(ctx)
	if err != nil {
		a.failStartup(fmt.Errorf("open application database: %w", err))
		return
	}
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("session.wa"))
	if err != nil {
		a.failStartup(fmt.Errorf("open WhatsApp session database: %w", err))
		return
	}
	container := sqlstore.NewWithDB(db, "sqlite3", dbLog)
	a.waContainer = container
	err = container.Upgrade(ctx)
	if err != nil {
		a.failStartup(fmt.Errorf("upgrade WhatsApp session database: %w", err))
		return
	}
	a.waClient = wa.NewClient(ctx, container)
	a.messageStore, err = store.NewMessageStore()
	if err != nil {
		a.failStartup(fmt.Errorf("open message store: %w", err))
		return
	}
	a.imageCache, err = cache.NewImageCache()
	if err != nil {
		a.failStartup(fmt.Errorf("open image cache: %w", err))
		return
	}
}

func (a *Api) Login() error {
	a.loginMu.Lock()
	defer a.loginMu.Unlock()

	if a.isShuttingDown() {
		return context.Canceled
	}
	a.lifecycleMu.Lock()
	if a.startupErr != nil {
		err := a.startupErr
		a.lifecycleMu.Unlock()
		return err
	}
	if a.waClient == nil {
		a.lifecycleMu.Unlock()
		return errors.New("WhatsApp client is not ready")
	}
	if !a.eventHandlerSet {
		a.eventHandlerID = a.waClient.AddEventHandler(a.mainEventHandler)
		a.eventHandlerSet = true
	}
	client := a.waClient
	a.lifecycleMu.Unlock()

	if client.Store.ID == nil {
		loginCtx, cancel := context.WithCancel(a.ctx)
		a.lifecycleMu.Lock()
		a.loginCancel = cancel
		a.lifecycleMu.Unlock()
		defer func() {
			cancel()
			a.lifecycleMu.Lock()
			a.loginCancel = nil
			a.lifecycleMu.Unlock()
		}()

		qrChan, err := client.GetQRChannel(loginCtx)
		if err != nil {
			return fmt.Errorf("create QR login channel: %w", err)
		}
		if a.isShuttingDown() {
			return context.Canceled
		}
		err = client.Connect()
		if err != nil {
			return err
		}
		for {
			select {
			case <-loginCtx.Done():
				return loginCtx.Err()
			case evt, ok := <-qrChan:
				if !ok {
					return nil
				}
				if evt.Event == "code" {
					runtime.EventsEmit(a.ctx, "wa:qr", evt.Code)
				} else {
					runtime.EventsEmit(a.ctx, "wa:status", evt.Event)
				}
			}
		}
	} else {
		// Already logged in, connect before announcing readiness.
		err := client.Connect()
		if err != nil {
			return err
		}
		if a.isShuttingDown() {
			return context.Canceled
		}
		runtime.EventsEmit(a.ctx, "wa:status", "logged_in")
	}
	return nil
}

func (a *Api) mainEventHandler(evt any) {
	a.eventMu.RLock()
	defer a.eventMu.RUnlock()
	if a.isShuttingDown() {
		return
	}
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
					"isFromMe":    v.Info.IsFromMe,
				})
			} else if !errors.Is(err, sql.ErrNoRows) {
				log.Println("Failed to get decoded message after processing:", err)
			}
		}

		// Raise a desktop notification for genuine incoming messages (not our
		// own, not reactions, not channel/broadcast posts) while backgrounded.
		// Respects the global notification switch and per-chat mutes
		// (including mutes synced from the phone).
		isFeed := v.Info.Chat.Server == types.NewsletterServer || v.Info.Chat.Server == types.BroadcastServer
		if messageID != "" && !v.Info.IsFromMe && !isFeed && v.Message.GetReactionMessage() == nil && !a.windowFocused.Load() &&
			store.GetNotificationsEnabled() && !a.messageStore.IsChatMuted(v.Info.Chat.String()) {
			a.startBackground(func() { a.notifyIncoming(v, parsedHTML) })
		}

		if reaction := v.Message.GetReactionMessage(); reaction != nil {
			a.startBackground(func() {
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
			})
		}

	case *events.Picture:
		a.startBackground(func() { _, _ = a.GetCachedAvatar(v.JID.String(), true) })

		runtime.EventsEmit(a.ctx, "wa:picture_update", v.JID.String())

	case *events.Mute:
		// Emitted for mutes set on other devices (e.g. the phone), including
		// during app-state full sync. Persist so notifications stay quiet.
		muted := v.Action.GetMuted()
		a.handleMuteEvent(v.JID, muted, v.Action.GetMuteEndTimestamp())

	case *events.Connected:
		// For new logins, there might be a problem where the whatsmeow client
		// gets a 515 code which gets resolved internally by auto-reconnecting
		// in a separate goroutine. In that case, the Initialise call below for
		// the AppDatabase will be executed first without the client even logging
		// in (which is the reason why the groups fetch fails and there are no
		// groups in the app until a manual reinitialize is done). To avoid that,
		// wait here until logged in.
		if err := a.cw.Initialise(a.waClient); err != nil {
			log.Println("group database initialization failed:", err)
		}
		// Heal group rows with missing/empty names in the background now
		// that the client can reach the server.
		a.startBackground(a.repairGroupNames)
		// NOTE: deliberately no app state resync here. FetchAppState(fullSync)
		// drops the stored version before re-downloading, so running it on every
		// connect destroys a collection recovered from the phone and re-fetches
		// the same unverifiable server snapshot — the collection never heals.
		// whatsmeow does its own incremental fetch after connecting; if that
		// fails, events.AppStateSyncError below picks the right repair.
		if err := a.waClient.SendPresence(a.ctx, types.PresenceAvailable); err != nil {
			log.Println("failed to send available presence:", err)
		}
		// Run migration for messages.db
		err := a.messageStore.MigrateLIDToPN(a.ctx, a.waClient.Store.LIDs)
		if err != nil {
			log.Println("Messages DB migration failed:", err)
		} else {
			log.Println("Messages DB migration completed successfully")
			runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
		}
	case *events.HistorySync:
		// whatsmeow delivers past conversations here after linking. Reuse the
		// same storage path as live messages so chats/history populate the UI.
		a.processHistorySync(v)
	case *events.Archive:
		// Chat archived/unarchived from another device (or app state sync).
		if err := a.messageStore.SetChatArchived(v.JID.String(), v.Action.GetArchived(), v.Timestamp.Unix()); err != nil {
			log.Println("Failed to store chat archive state:", err)
		}
		runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
	case *events.Pin:
		// Chat pinned/unpinned from another device (or during app state sync).
		if err := a.messageStore.SetChatPinned(v.JID.String(), v.Action.GetPinned(), v.Timestamp.Unix()); err != nil {
			log.Println("Failed to store chat pin:", err)
		}
		runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
	case *events.AppStateSyncError:
		// A broken hash chain for this collection. If even the server snapshot
		// fails to verify, a full sync (resyncAppState) hits the same wall on
		// every connect, so ask the phone for a plain copy instead.
		if errors.Is(v.Error, appstate.ErrMismatchingLTHash) {
			log.Printf("App state %s is unrecoverable via sync (%v); requesting recovery from phone", v.Name, v.Error)
			a.startBackground(func() { a.requestAppStateRecovery(v.Name) })
		}
	case *events.AppStateSyncComplete:
		// A phone-recovery snapshot was applied (see requestAppStateRecovery):
		// the version and LTHash are rewritten, so the chain is healed and full
		// syncs are safe for this collection again.
		if v.Recovery {
			log.Printf("App state %s recovered from phone (v%d)", v.Name, v.Version)
			a.appStateRecoveryReq.Delete(v.Name)
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

// processHistorySync stores the messages contained in a whatsmeow HistorySync
// event. WhatsApp sends these in several batches after a device is linked
// (bootstrap, recent, full). Each conversation's WebMessageInfo entries are
// converted into the same *events.Message shape that live messages use, then
// persisted through the existing MessageStore so the chat list and history
// render exactly like incoming messages do.
func (a *Api) processHistorySync(v *events.HistorySync) {
	conversations := v.Data.GetConversations()
	if len(conversations) == 0 {
		return
	}
	stored := 0
	for _, conv := range conversations {
		chatJID, err := types.ParseJID(conv.GetID())
		if err != nil {
			continue
		}
		for _, histMsg := range conv.GetMessages() {
			webMsg := histMsg.GetMessage()
			if webMsg == nil {
				continue
			}
			parsedMsg, err := a.waClient.ParseWebMessage(chatJID, webMsg)
			if err != nil || parsedMsg.Message == nil {
				continue
			}
			// ParseWebMessage doesn't unwrap containers (ephemeral/view-once)
			// like the live path does, so do it here or the content is lost.
			parsedMsg.Message = store.UnwrapMessage(parsedMsg.Message)
			if parsedMsg.Message == nil {
				continue
			}
			parsedHTML := a.processMessageText(parsedMsg.Message)
			if a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, parsedMsg, parsedHTML) != "" {
				stored++
			}
		}
	}
	log.Printf("History sync: stored %d messages from %d conversations", stored, len(conversations))
	runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
}
