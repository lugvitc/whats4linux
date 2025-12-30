import type { MouseEventHandler } from "react"
import { useState, useRef } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import clsx from "clsx"

const Button = ({ onClick }: { onClick: MouseEventHandler<HTMLDivElement> }) => {
  const [isToggled, setIsToggled] = useState<boolean>(false)
  const circleRef = useRef<HTMLDivElement>(null)

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsToggled(!isToggled)
    onClick(e)
  }

  useGSAP(() => {
    gsap.to(circleRef.current, {
      x: isToggled ? 20 : 0,
      duration: 0.6,
      ease: "elastic.out(1, 0.5)",
    })
  }, [isToggled])

  return (
    <div
      className={clsx(
        "h-7 w-12 rounded-full flex items-center px-1 cursor-pointer shrink-0",
        isToggled ? "bg-green" : "bg-gray-300",
      )}
      onClick={handleClick}
    >
      <div className="size-5 rounded-full bg-black" ref={circleRef} />
    </div>
  )
}

export default Button
