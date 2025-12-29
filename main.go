package main

import (
	"embed"

	apiPkg "github.com/lugvitc/whats4linux/api"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/utils/unix"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {

	lock := lockfile.EnsureSingleInstance(misc.APP_LOCK_FILE)
	defer lock.Release()

	// Create an instance of the app structure
	api := apiPkg.New()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  misc.APP_NAME,
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        api.Startup,
		Bind: []any{
			api,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
