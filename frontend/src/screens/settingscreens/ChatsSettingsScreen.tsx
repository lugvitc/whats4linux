import SettingButtonDesc from "../../components/settings/SettingButtonDesc"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"

const ChatsSettingsScreen = () => {
  const { spellCheck, replaceTextWithEmojis, enterIsSend, updateSetting } = useAppSettingsStore()

  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc
        title="Spell Check"
        description="Check Spelling as you type"
        onToggle={() => updateSetting("spellCheck", !spellCheck)}
        isEnabled={spellCheck}
      />
      <SettingButtonDesc
        title="Replace text with emojis"
        description="Emoji will replace specific text as you type"
        onToggle={() => updateSetting("replaceTextWithEmojis", !replaceTextWithEmojis)}
        isEnabled={replaceTextWithEmojis}
      />
      <SettingButtonDesc
        title="Enter is send"
        description="Pressing Enter will send the message instead of creating a new line"
        onToggle={() => updateSetting("enterIsSend", !enterIsSend)}
        isEnabled={enterIsSend}
      />
    </div>
  )
}

export default ChatsSettingsScreen
