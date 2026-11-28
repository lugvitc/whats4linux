package wa

import (
	"testing"

	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	waStore "go.mau.fi/whatsmeow/store"
	"google.golang.org/protobuf/proto"
)

func TestConfigureHistorySync(t *testing.T) {
	original := proto.Clone(waStore.DeviceProps)
	t.Cleanup(func() { waStore.DeviceProps = original.(*waCompanionReg.DeviceProps) })

	waStore.DeviceProps.RequireFullSync = nil
	waStore.DeviceProps.HistorySyncConfig = nil
	configureHistorySync()

	if !waStore.DeviceProps.GetRequireFullSync() {
		t.Fatal("full history sync was not requested")
	}
	config := waStore.DeviceProps.GetHistorySyncConfig()
	if config == nil || !config.GetOnDemandReady() || !config.GetCompleteOnDemandReady() {
		t.Fatal("on-demand history sync was not advertised")
	}
	if config.GetInitialSyncMaxMessagesPerChat() == 0 || config.GetFullSyncDaysLimit() == 0 {
		t.Fatal("initial history sync limits were not configured")
	}
}
