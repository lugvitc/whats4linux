import SimpleIconTitle from "../../components/settings/SimpleIconTitle"

const AccountSettingsScreen = () => {
  return (
    <div className="flex flex-col gap-4 max-w-3/4">
      <SimpleIconTitle
        title="How to Delete my account"
        icon="⚙️"
        link="https://faq.whatsapp.com/2138577903196467/?cms_platform=android&lang=en"
      />
    </div>
  )
}

export default AccountSettingsScreen
