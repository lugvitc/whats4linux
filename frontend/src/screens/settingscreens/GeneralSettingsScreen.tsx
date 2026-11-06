import SettingButtonDesc from "../../components/settings/SettingButtonDesc"
import DropDown from "../../components/settings/DropDown"
import { useEffect, useState } from "react"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"
import { GetStartAtLogin, SetStartAtLogin } from "../../../wailsjs/go/api/Api"

const GeneralSettingsScreen = () => {
  const { minimizeToTray, language, fontSize, updateSetting } = useAppSettingsStore()
  // Backed by the autostart entry on disk, not app settings, so it reflects
  // the real state even if the entry was removed by hand.
  const [startAtLogin, setStartAtLogin] = useState(false)

  useEffect(() => {
    GetStartAtLogin().then(setStartAtLogin).catch(console.error)
  }, [])

  const toggleStartAtLogin = async () => {
    const next = !startAtLogin
    try {
      await SetStartAtLogin(next)
      setStartAtLogin(next)
    } catch (err) {
      console.error("Failed to update start at login:", err)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc
        title="Start Whatsapp at login"
        description="Starts minimized to the system tray"
        onToggle={toggleStartAtLogin}
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
