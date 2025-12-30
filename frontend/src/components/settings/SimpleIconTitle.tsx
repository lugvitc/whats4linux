import clsx from "clsx"
import type { ReactNode } from "react"

const SimpleIconTitle = ({
  title,
  icon,
  clickable = true,
  anchor,
  link,
  onNavigate,
}: {
  title: string
  icon: string
  clickable?: boolean
  anchor?: ReactNode
  link?: string
  onNavigate?: (anchor: ReactNode) => void
}) => {
  const handleClick = () => {
    if (!clickable) return
    if (anchor && onNavigate) {
      onNavigate(anchor)
    } else if (link) {
      window.open(link, "_blank")
    }
  }

  return (
    <div
      className={clsx(
        "flex flex-row items-center gap-4 w-full p-4 rounded-xl",
        clickable && "cursor-pointer hover:bg-hover-icons",
      )}
      onClick={handleClick}
    >
      <div>{icon}</div>
      <div className="text-xl font-semibold">{title}</div>
    </div>
  )
}

export default SimpleIconTitle
