import SettingButtonDesc from "../../components/settings/SettingButtonDesc"

const ChatsSettingsScreen = () => {
  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc
        title="Spell Check"
        description="Check Spelling as you type"
        settingtoggle={() => {}}
      />
      <SettingButtonDesc
        title="Replace text with emojis"
        description="Emoji will replace specific text as you type"
        settingtoggle={() => {}}
      />
      <SettingButtonDesc
        title="Enter is send"
        description="Pressing Enter will send the message instead of creating a new line"
        settingtoggle={() => {}}
      />
    </div>
  )
}

export default ChatsSettingsScreen
