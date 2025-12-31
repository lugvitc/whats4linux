import { useRef, useEffect } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import clsx from "clsx"
import { getEase } from "../../store/useEaseStore"

interface ToggleButtonProps {
  isEnabled: boolean
  onToggle: () => void
}

const ToggleButton = ({ isEnabled, onToggle }: ToggleButtonProps) => {
  const circleRef = useRef<HTMLDivElement>(null)

  const easeRef = useRef(getEase("ToggleButton", "slide"))

  useEffect(() => {
    easeRef.current = getEase("ToggleButton", "slide")
  })

  useGSAP(() => {
    if (!circleRef.current) return

    gsap.to(circleRef.current, {
      x: isEnabled ? 20 : 0,
      duration: 0.6,
      ease: easeRef.current,
      overwrite: "auto",
    })
  }, [isEnabled])

  return (
    <div
      onClick={onToggle}
      className={clsx(
        "h-7 w-12 rounded-full flex items-center px-1 cursor-pointer shrink-0 transition-colors duration-300",
        isEnabled
          ? "bg-toggle-bg dark:bg-toggle-dark-bg"
          : "bg-toggle-closed dark:bg-toggle-dark-closed",
      )}
    >
      <div
        ref={circleRef}
        className="size-5 rounded-full bg-toggle-circle dark:bg-toggle-dark-circle shadow-md"
      />
    </div>
  )
}

export default ToggleButton
