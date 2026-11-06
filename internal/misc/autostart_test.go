package misc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestQuoteExecArg(t *testing.T) {
	cases := map[string]string{
		"/usr/bin/whats4linux": `"/usr/bin/whats4linux"`,
		"/home/a b/w4l":        `"/home/a b/w4l"`,
		`/x/$HOME"q"/100%`:     `"/x/\\$HOME\\"q\\"/100%%"`,
		"/x/back`tick`\\slash": "\"/x/back\\\\`tick\\\\`\\\\\\\\slash\"",
	}
	for in, want := range cases {
		if got := quoteExecArg(in); got != want {
			t.Errorf("quoteExecArg(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestSetAutostart(t *testing.T) {
	cfg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", cfg)
	t.Setenv("APPIMAGE", "/opt/apps/Whats4Linux.AppImage")
	entry := filepath.Join(cfg, "autostart", APP_NAME+".desktop")

	if AutostartEnabled() {
		t.Fatal("enabled before setting it")
	}
	if err := SetAutostart(true); err != nil {
		t.Fatal(err)
	}
	if !AutostartEnabled() {
		t.Fatal("not enabled after SetAutostart(true)")
	}
	data, err := os.ReadFile(entry)
	if err != nil {
		t.Fatal(err)
	}
	if want := `Exec="/opt/apps/Whats4Linux.AppImage" --hidden`; !strings.Contains(string(data), want) {
		t.Errorf("entry missing %q:\n%s", want, data)
	}

	if err := SetAutostart(false); err != nil {
		t.Fatal(err)
	}
	if AutostartEnabled() {
		t.Fatal("still enabled after SetAutostart(false)")
	}
	// Disabling twice is fine.
	if err := SetAutostart(false); err != nil {
		t.Fatal(err)
	}
}
