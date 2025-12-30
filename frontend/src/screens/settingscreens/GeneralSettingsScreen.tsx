import SettingButtonDesc from "../../components/settings/SettingButtonDesc"
import DropDown from "../../components/settings/DropDown"
const GeneralSettingsScreen = () => {
  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc title="Start Whatsapp at login" description="" settingtoggle={() => {}} />
      <SettingButtonDesc
        title="Minimize to system tray"
        description="Keep Whatsapp running after closing the application window"
        settingtoggle={() => {}}
      />
      <DropDown
        title="Language"
        elements={["English", "Spanish", "French"]}
        settingtoggle={() => {}}
      />
      <DropDown
        title="Font Size"
        elements={["80%", "90%", "100% (Default)", "110%", "120%", "130%"]}
        settingtoggle={() => {}}
      />
      <div>Use Ctrl + / - to increase or decrease font size</div>
    </div>
  )
}

export default GeneralSettingsScreen
