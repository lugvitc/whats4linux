package main

import (
	"embed"

	"net/http"
	"os"
	"path/filepath"
	"strings"

	apiPkg "github.com/lugvitc/whats4linux/api"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

type FileLoader struct {
	http.Handler
}

func NewFileLoader() *FileLoader {
	return &FileLoader{}
}

func (h *FileLoader) ServeHTTP(res http.ResponseWriter, req *http.Request) {
	if strings.HasPrefix(req.URL.Path, "/cached-image/") {
		requestedFilename := strings.TrimPrefix(req.URL.Path, "/cached-image/")

		// Security: Prevent directory traversal
		// We only expect flat filenames (hashes + extension)
		if filepath.Base(requestedFilename) != requestedFilename {
			res.WriteHeader(http.StatusBadRequest)
			return
		}

		homeDir, _ := os.UserHomeDir()
		fullPath := filepath.Join(homeDir, ".cache", "whats4linux", "images", requestedFilename)

		// Check if file exists
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			res.WriteHeader(http.StatusNotFound)
			return
		}

		http.ServeFile(res, req, fullPath)
		return
	}
	res.WriteHeader(http.StatusNotFound)
}

func main() {

	store.LoadSettings()
	defer store.CloseSettings()

	// Create an instance of the app structure
	api := apiPkg.New()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  misc.APP_NAME,
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: NewFileLoader(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        api.Startup,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               misc.APP_ID,
			OnSecondInstanceLaunch: api.OnSecondInstanceLaunch,
		},
		Bind: []any{
			api,
		},
        Linux: &linux.Options{
            WindowIsTranslucent: false,
            WebviewGpuPolicy: linux.WebviewGpuPolicyAlways,
            ProgramName: "whats4linux",
        },
	})

	if err != nil {
		println("Error:", err.Error())

	}
}
