//go:build !linux
// +build !linux

package misc

import "log"

func StartSystray() error {
	log.Println("Systray is not supported on this platform")
	return nil
}
