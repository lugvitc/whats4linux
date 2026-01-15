package cmd

import (
	"io/fs"

	apiPkg "github.com/lugvitc/whats4linux/api"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/server"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/urfave/cli"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

func run(assets fs.FS) cli.ActionFunc {
	store.LoadSettings()
	defer store.CloseSettings()

	// Create an instance of the app structure
	api := apiPkg.New()

	// Create application with options
	return func(ctx *cli.Context) error {
		return wails.Run(&options.App{
			Title:  misc.APP_NAME,
			Width:  1024,
			Height: 768,
			AssetServer: &assetserver.Options{
				Assets:  assets,
				Handler: server.NewAssetFileServer(),
			},
			BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
			OnStartup:        api.Startup,
			OnShutdown:       api.Shutdown,
			SingleInstanceLock: &options.SingleInstanceLock{
				UniqueId:               misc.APP_ID,
				OnSecondInstanceLaunch: api.OnSecondInstanceLaunch,
			},
			Bind: []any{
				api,
			},
			Linux: &linux.Options{
				WindowIsTranslucent: false,
				WebviewGpuPolicy:    linux.WebviewGpuPolicyAlways,
				ProgramName:         APP_NAME,
			},
		})
	}
}
