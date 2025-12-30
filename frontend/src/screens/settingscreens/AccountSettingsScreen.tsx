import SimpleIconTitle from "../../components/settings/SimpleIconTitle"
import SecurityNotificationsScreen from "./account/SecurityNotificationsScreen"
import type { ReactNode } from "react"

const AccountSettingsScreen = ({ onNavigate }: { onNavigate?: (anchor: ReactNode) => void }) => {
  return (
    <div className="flex flex-col gap-4 max-w-3/4">
      <SimpleIconTitle
        title="How to Delete my account"
        icon="⚙️"
        link="https://faq.whatsapp.com/2138577903196467/?cms_platform=android&lang=en"
      />
      <SimpleIconTitle
        title="Security Notifications"
        icon="⚙️"
        anchor={<SecurityNotificationsScreen />}
        onNavigate={onNavigate}
      />
    </div>
  )
}

export default AccountSettingsScreen
