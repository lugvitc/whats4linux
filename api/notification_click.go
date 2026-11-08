package api

// notificationClicker sends notifications that can identify the chat to open
// when the user clicks them. Platforms without this support use beeep directly.
type notificationClicker interface {
	Notify(title, body, chatID string) error
	Close() error
}
