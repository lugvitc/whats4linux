import Button from "./ToggleButton"
const SettingButtonDesc = ({
  title,
  description,
  settingtoggle,
}: {
  title: string
  description: string
  settingtoggle: () => void
}) => {
  return (
    <div className="flex flex-row justify-between">
      <div className="flex flex-col">
        {/* on dark mode, this should turn white using zustand  */}
        <div className="text-xl text-black dark:text-white">{title}</div>
        <div className="text-md">{description}</div>
      </div>
      <Button onClick={settingtoggle} />
    </div>
  )
}

export default SettingButtonDesc
