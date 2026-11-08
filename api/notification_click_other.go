//go:build !linux || nodbus

package api

func newNotificationClicker(func(string)) notificationClicker {
	return nil
}
