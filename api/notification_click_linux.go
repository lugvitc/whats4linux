//go:build linux && !nodbus

package api

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/esiqveland/notify"
	"github.com/godbus/dbus/v5"
)

type linuxNotificationClicker struct {
	notifier notify.Notifier
	conn     *dbus.Conn
	mu       sync.Mutex
	chats    map[uint32]string
	onOpen   func(string)
}

func newNotificationClicker(onOpen func(string)) notificationClicker {
	conn, err := dbus.SessionBus()
	if err != nil {
		log.Printf("desktop notification actions unavailable: %v", err)
		return nil
	}

	clicker := &linuxNotificationClicker{
		conn:   conn,
		chats:  make(map[uint32]string),
		onOpen: onOpen,
	}
	notifier, err := notify.New(conn, notify.WithOnAction(clicker.handleAction))
	if err != nil {
		_ = conn.Close()
		log.Printf("desktop notification actions unavailable: %v", err)
		return nil
	}
	clicker.notifier = notifier
	return clicker
}

func (n *linuxNotificationClicker) Notify(title, body, chatID string) error {
	id, err := n.notifier.SendNotification(notify.Notification{
		AppName:       "whats4linux",
		Summary:       title,
		Body:          body,
		Actions:       []notify.Action{{Key: "default", Label: "Open"}},
		ExpireTimeout: 5 * time.Second,
	})
	if err != nil {
		return err
	}

	n.mu.Lock()
	n.chats[id] = chatID
	n.mu.Unlock()
	return nil
}

func (n *linuxNotificationClicker) handleAction(action *notify.ActionInvokedSignal) {
	if action.ActionKey != "default" {
		return
	}

	n.mu.Lock()
	chatID, ok := n.chats[action.ID]
	delete(n.chats, action.ID)
	n.mu.Unlock()
	if ok && chatID != "" && n.onOpen != nil {
		n.onOpen(chatID)
	}
}

func (n *linuxNotificationClicker) Close() error {
	if n.notifier == nil {
		return nil
	}
	err := n.notifier.Close()
	if closeErr := n.conn.Close(); err == nil {
		err = closeErr
	} else if closeErr != nil {
		err = fmt.Errorf("%w; dbus close: %v", err, closeErr)
	}
	return err
}
