package misc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// HiddenFlag starts the app minimized to the system tray. The autostart
// entry passes it so logging in doesn't pop up the window.
const HiddenFlag = "--hidden"

// autostartPath is the XDG autostart entry, honoured by GNOME, KDE, XFCE and
// most other desktops.
func autostartPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "autostart", APP_NAME+".desktop"), nil
}

// AutostartEnabled reports whether the autostart entry exists. The file is the
// source of truth, so deleting it by hand turns the setting off.
func AutostartEnabled() bool {
	p, err := autostartPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// SetAutostart creates or removes the autostart entry. The entry points at the
// currently running binary (or AppImage), so it follows wherever the app was
// launched from when the setting was turned on.
func SetAutostart(enabled bool) error {
	p, err := autostartPath()
	if err != nil {
		return err
	}
	if !enabled {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}

	exe, err := launchPath()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	entry := strings.Join([]string{
		"[Desktop Entry]",
		"Type=Application",
		"Name=Whats4Linux",
		"Comment=Unofficial WhatsApp client for Linux",
		"Exec=" + quoteExecArg(exe) + " " + HiddenFlag,
		"Icon=" + APP_NAME,
		"Terminal=false",
		"X-GNOME-Autostart-enabled=true",
		"",
	}, "\n")

	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte(entry), 0o644)
}

// launchPath returns the path that starts this app. Inside an AppImage the
// executable lives on a temporary mount, so use the AppImage file itself.
func launchPath() (string, error) {
	if appImage := os.Getenv("APPIMAGE"); appImage != "" {
		return appImage, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return exe, nil
}

// quoteExecArg quotes an argument for a desktop entry Exec key, per the
// Desktop Entry Specification.
func quoteExecArg(s string) string {
	r := strings.NewReplacer(`\`, `\\\\`, `"`, `\\"`, "`", "\\\\`", `$`, `\\$`, `%`, `%%`)
	return `"` + r.Replace(s) + `"`
}
