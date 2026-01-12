//go:build linux
// +build linux

package misc

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func StartSystray() error {
	appDir := os.Getenv("APPDIR")
	if appDir == "" {
		return fmt.Errorf("APPDIR not set")
	}

	trayPath := filepath.Join(appDir, "usr", "bin", "whats4linux_tray")

	cmd := exec.Command(trayPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Start()
}
