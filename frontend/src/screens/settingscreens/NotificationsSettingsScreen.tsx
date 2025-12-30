import React from "react"
import SettingButtonDesc from "../../components/settings/SettingButtonDesc"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"

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

  return (
    <div className="flex flex-col gap-4">
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
