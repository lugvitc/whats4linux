import React from "react"
import SettingButtonDesc from "../../components/settings/SettingButtonDesc"

const NotificationsSettingsScreen = () => {
  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc
        title="Message notifications"
        description="Show notifications for new messages"
        settingtoggle={() => {}}
      />
      <SettingButtonDesc title="Show previews" description="" settingtoggle={() => {}} />
      <SettingButtonDesc
        title="Show reaction notifications"
        description=""
        settingtoggle={() => {}}
      />
      <SettingButtonDesc
        title="Status reactions"
        description="Show notifications when you get likes on a status"
        settingtoggle={() => {}}
      />
      <SettingButtonDesc
        title="Call notifications"
        description="Show notifications for incoming calls"
        settingtoggle={() => {}}
      />
      <SettingButtonDesc
        title="Incoming calls"
        description="Play sounds for incoming calls"
        settingtoggle={() => {}}
      />

      <SettingButtonDesc
        title="Incoming sounds"
        description="Play sounds for incoming messages"
        settingtoggle={() => {}}
      />
      <SettingButtonDesc
        title="Outgoing sounds"
        description="Play sounds for outgoing messages"
        settingtoggle={() => {}}
      />
    </div>
  )
}

export default NotificationsSettingsScreen
