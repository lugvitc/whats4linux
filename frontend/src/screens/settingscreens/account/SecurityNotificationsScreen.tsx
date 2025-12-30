import SettingButtonDesc from "../../../components/settings/SettingButtonDesc"
import SimpleIconTitle from "../../../components/settings/SimpleIconTitle"

const SecurityNotificationsScreen = () => {
  return (
    <div className="flex flex-col gap-4">
      {/* TODO: add the security icon from whatsapp */}
      <div className="text-xl font-semibold">Your chats and calls are private</div>
      <div className="text-lg">
        End-to-end encryption keeps your personal messages and calls between you and the people you
        choose. No one outside of the chat, not even WhatsApp, can read, listen to, or share them.
        This includes your:
      </div>
      <div className="flex flex-col">
        <SimpleIconTitle title="Text and Voice messages" icon="💬" clickable={false} />
        <SimpleIconTitle title="Audio and Video calls" icon="💬" clickable={false} />
        <SimpleIconTitle title="Photos, videos and documents" icon="💬" clickable={false} />
        <SimpleIconTitle title="Location Sharing" icon="💬" clickable={false} />
        <SimpleIconTitle title="Status updates" icon="💬" clickable={false} />
      </div>
      <div
        onClick={() => {
          window.open("https://www.whatsapp.com/security/?lg=en", "_blank")
        }}
        className="text-green cursor-pointer"
      >
        Learn More
      </div>
      <SettingButtonDesc
        title="Show security notifications on this computer"
        description="Get notified when your security code changes for a contact's phone. If you have multiple devices, this setting must be enabled on each device where you want to get notifications. Leam more"
        onToggle={() => {}}
      />
    </div>
  )
}

export default SecurityNotificationsScreen
