package wa

import (
	"context"

	"github.com/lugvitc/whats4linux/internal/settings"
	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func NewClient(ctx context.Context, container *sqlstore.Container) *whatsmeow.Client {
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		panic(err)
	}
	clientLog := waLog.Stdout("Client", settings.GetLogLevel(), true)
	return whatsmeow.NewClient(deviceStore, clientLog)
}
