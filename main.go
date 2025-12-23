package main

import (
	"embed"
	"os"

	apiPkg "github.com/lugvitc/whats4linux/api"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend
var assets embed.FS

func main() {
	// force saftey flags
	os.Setenv("WEBKIT_FORCE_SANDBOX", "0")
	os.Setenv("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
	os.Setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
	os.Setenv("GDK_BACKEND", "x11")

	// Create an instance of the app structure
	api := apiPkg.New()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "whats4linux",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        api.Startup,
		Bind: []interface{}{
			api,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
