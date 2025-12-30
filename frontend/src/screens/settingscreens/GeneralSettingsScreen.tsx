import SettingButtonDesc from "../../components/settings/SettingButtonDesc"
import DropDown from "../../components/settings/DropDown"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"

const GeneralSettingsScreen = () => {
  const { startAtLogin, minimizeToTray, language, fontSize, updateSetting } = useAppSettingsStore()

  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc
        title="Start Whatsapp at login"
        description=""
        onToggle={() => updateSetting("startAtLogin", !startAtLogin)}
        isEnabled={startAtLogin}
      />
      <SettingButtonDesc
        title="Minimize to system tray"
        description="Keep Whatsapp running after closing the application window"
        onToggle={() => updateSetting("minimizeToTray", !minimizeToTray)}
        isEnabled={minimizeToTray}
      />
      <DropDown
        title="Language"
        elements={["English", "Spanish", "French"]}
        onToggle={(value: string) => updateSetting("language", value)}
        // selectedValue={language}
      />
      <DropDown
        title="Font Size"
        elements={["80%", "90%", "100% (Default)", "110%", "120%", "130%"]}
        onToggle={(value: string) => updateSetting("fontSize", value)}
        // selectedValue={fontSize}
      />
      <div>Use Ctrl + / - to increase or decrease font size</div>
    </div>
  )
}

export default GeneralSettingsScreen
