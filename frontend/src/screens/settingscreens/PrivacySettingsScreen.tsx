import SettingButtonDesc from "../../components/settings/SettingButtonDesc"

const PrivacySettingsScreen = () => {
  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc
        title="Read Receipts"
        description="If turned off, you won't send or receive read receipts. Read receipts are always sent for group chats."
        settingtoggle={() => {}} // TODO for future me: zustand read recipts toggle
      />
      <SettingButtonDesc
        title="Block Unknown Account Messages"
        description="To protect your account and improve device performance, WhatsApp will block messages from unknown accounts if they exceed a certain volume."
        settingtoggle={() => {}}
      />
      <SettingButtonDesc
        title="Disable Link Previews"
        description="To help protect your IP address from being inferred by third-party websites, previews for the links you share in chats will no longer be generated. Learn more"
        settingtoggle={() => {}}
      />
    </div>
  )
}

export default PrivacySettingsScreen
