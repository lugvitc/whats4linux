import { useCallback, useEffect, useState } from "react"
import SettingButtonDesc from "../../components/settings/SettingButtonDesc"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"
import { GetNotificationsEnabled, SetNotificationsEnabled } from "../../../wailsjs/go/api/Api"
import { EventsOn } from "../../../wailsjs/runtime/runtime"

const NotificationsSettingsScreen = () => {
  const {
    messageNotifications,
    showPreviews,
    showReactionNotifications,
    statusReactions,
    callNotifications,
    incomingCallSounds,
    incomingSounds,
    outgoingSounds,
    updateSetting,
  } = useAppSettingsStore()

  // Backend-owned global switch (also flippable from the system tray).
  const [desktopNotifications, setDesktopNotifications] = useState(true)
  const [desktopBusy, setDesktopBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    GetNotificationsEnabled()
      .then(enabled => {
        if (!cancelled) setDesktopNotifications(!!enabled)
      })
      .catch(err => {
        console.error("Failed to load notifications state:", err)
      })

    const unsub = EventsOn("wa:notifications_toggled", (enabled: boolean) => {
      setDesktopNotifications(!!enabled)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const handleToggleDesktopNotifications = useCallback(async () => {
    if (desktopBusy) return
    const next = !desktopNotifications

    // Optimistic update, revert on failure.
    setDesktopBusy(true)
    setDesktopNotifications(next)
    try {
      await SetNotificationsEnabled(next)
    } catch (err) {
      console.error("Failed to toggle desktop notifications:", err)
      setDesktopNotifications(!next)
    } finally {
      setDesktopBusy(false)
    }
  }, [desktopBusy, desktopNotifications])

  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc
        title="Desktop notifications"
        description="Show desktop notifications for incoming messages"
        onToggle={handleToggleDesktopNotifications}
        isEnabled={desktopNotifications}
      />
      <SettingButtonDesc
        title="Message notifications"
        description="Show notifications for new messages"
        onToggle={() => updateSetting("messageNotifications", !messageNotifications)}
        isEnabled={messageNotifications}
      />
      <SettingButtonDesc
        title="Show previews"
        description=""
        onToggle={() => updateSetting("showPreviews", !showPreviews)}
        isEnabled={showPreviews}
      />
      <SettingButtonDesc
        title="Show reaction notifications"
        description=""
        onToggle={() => updateSetting("showReactionNotifications", !showReactionNotifications)}
        isEnabled={showReactionNotifications}
      />
      <SettingButtonDesc
        title="Status reactions"
        description="Show notifications when you get likes on a status"
        onToggle={() => updateSetting("statusReactions", !statusReactions)}
        isEnabled={statusReactions}
      />
      <SettingButtonDesc
        title="Call notifications"
        description="Show notifications for incoming calls"
        onToggle={() => updateSetting("callNotifications", !callNotifications)}
        isEnabled={callNotifications}
      />
      <SettingButtonDesc
        title="Incoming calls"
        description="Play sounds for incoming calls"
        onToggle={() => updateSetting("incomingCallSounds", !incomingCallSounds)}
        isEnabled={incomingCallSounds}
      />

      <SettingButtonDesc
        title="Incoming sounds"
        description="Play sounds for incoming messages"
        onToggle={() => updateSetting("incomingSounds", !incomingSounds)}
        isEnabled={incomingSounds}
      />
      <SettingButtonDesc
        title="Outgoing sounds"
        description="Play sounds for outgoing messages"
        onToggle={() => updateSetting("outgoingSounds", !outgoingSounds)}
        isEnabled={outgoingSounds}
      />
    </div>
  )
}

export default NotificationsSettingsScreen
