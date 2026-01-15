package misc

import (
	"os"
	"os/exec"
	"path/filepath"
)

func StartSystray() error {
	var baseDir string

	if appDir := os.Getenv("APPDIR"); appDir != "" {
		baseDir = filepath.Join(appDir, "usr", "bin")
	} else {
		exePath, err := os.Executable()
		if err != nil {
			return err
		}
		baseDir = filepath.Dir(exePath)
	}

	trayPath := filepath.Join(baseDir, "whats4linux_tray")

	cmd := exec.Command(trayPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Start()
}
