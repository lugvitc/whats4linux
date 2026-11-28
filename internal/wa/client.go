package wa

import (
	"context"

	"github.com/lugvitc/whats4linux/internal/settings"
	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

// configureHistorySync must run before a new device is paired: DeviceProps is
// serialized into the companion registration payload. The defaults leave the
// on-demand capability unset and don't ask the phone for a full initial sync.
func configureHistorySync() {
	waStore.DeviceProps.RequireFullSync = proto.Bool(true)
	if waStore.DeviceProps.HistorySyncConfig == nil {
		waStore.DeviceProps.HistorySyncConfig = &waCompanionReg.DeviceProps_HistorySyncConfig{}
	}
	config := waStore.DeviceProps.HistorySyncConfig
	config.FullSyncDaysLimit = proto.Uint32(365)
	config.FullSyncSizeMbLimit = proto.Uint32(1024)
	config.StorageQuotaMb = proto.Uint32(10240)
	config.RecentSyncDaysLimit = proto.Uint32(30)
	config.InitialSyncMaxMessagesPerChat = proto.Uint32(100)
	config.OnDemandReady = proto.Bool(true)
	config.CompleteOnDemandReady = proto.Bool(true)
}

func NewClient(ctx context.Context, container *sqlstore.Container) *whatsmeow.Client {
	configureHistorySync()
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		panic(err)
	}
	clientLog := waLog.Stdout("Client", settings.GetLogLevel(), true)
	cli := whatsmeow.NewClient(deviceStore, clientLog)
	// Without this, a full app state sync applies patches but dispatches NO
	// events (whatsmeow drops them unless the flag is set), so archive/pin/
	// mute state synced from the phone would never reach our handlers.
	cli.EmitAppStateEventsOnFullSync = true
	return cli
}
