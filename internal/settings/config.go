package settings

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/lugvitc/whats4linux/internal/misc"
)

type _settings struct {
	Debug    bool   `json:"debug"`
	LogLevel string `json:"log_level"`
}

var s _settings

func init() {
	defer s.setupEnvVars()
	b, err := os.ReadFile(
		filepath.Join(misc.ConfigDir, "settings.json"),
	)
	if err != nil {
		return
	}
	// fail silently
	_ = json.Unmarshal(b, &s)
}

func (s *_settings) GetDebug() bool {
	return s.Debug
}

func GetLogLevel() string {
	if s.Debug {
		return "DEBUG"
	}
	if s.LogLevel == "" {
		return "INFO"
	}
	return s.LogLevel
}
