import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { useState, useRef, useEffect } from "react"
import clsx from "clsx"
import { getEase } from "../../store/useEaseStore"

const DropDown = ({
  title,
  elements,
  icon,
  onToggle,
  placeholder = "Select an option",
}: {
  title: string
  elements: string[]
  icon?: React.ReactNode
  onToggle: (element: string) => void
  placeholder?: string
}) => {
  const [onOpen, setOnOpen] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const arrowRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const easeOpenRef = useRef(getEase("DropDown", "open"))
  const easeCloseRef = useRef(getEase("DropDown", "close"))
  const easeRotateRef = useRef(getEase("DropDown", "rotate"))

  useEffect(() => {
    easeOpenRef.current = getEase("DropDown", "open")
    easeCloseRef.current = getEase("DropDown", "close")
    easeRotateRef.current = getEase("DropDown", "rotate")
  })

  const toggleOpen = () => {
    setOnOpen(!onOpen)
  }

  const handleSelect = (element: string) => {
    setSelectedElement(element)
    onToggle(element)
    setOnOpen(false)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOnOpen(false)
      }
    }

    if (onOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [onOpen])

  useGSAP(() => {
    if (!dropdownRef.current || !arrowRef.current) return

    if (onOpen) {
      gsap.set(dropdownRef.current, { height: "auto" })
      const h = dropdownRef.current.offsetHeight

      gsap.fromTo(
        dropdownRef.current,
        { height: 0, opacity: 0 },
        { height: h, opacity: 1, duration: 0.3, ease: easeOpenRef.current },
      )

      gsap.to(arrowRef.current, {
        rotation: 180,
        duration: 0.3,
        ease: easeRotateRef.current,
      })
    } else {
      gsap.to(dropdownRef.current, {
        height: 0,
        opacity: 0,
        duration: 0.3,
        ease: easeCloseRef.current,
      })

      gsap.to(arrowRef.current, {
        rotation: 0,
        duration: 0.3,
        ease: easeRotateRef.current,
      })
    }
  }, [onOpen])

  return (
    <div ref={containerRef} className="flex flex-col">
      <div className="font-semibold mb-2">{title}</div>
      <div
        className="bg-dropdown-bg dark:bg-dropdown-dark-bg cursor-pointer flex items-center justify-between p-2 hover:bg-dropdown-hover-bg dark:hover:bg-dropdown-dark-hover-bg rounded-md transition-colors border border-dropdown-border dark:border-dropdown-dark-border text-dropdown-text dark:text-dropdown-dark-text"
        onClick={toggleOpen}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span>{selectedElement || placeholder}</span>
        </div>
        <span ref={arrowRef} className="inline-block">
          ▼
        </span>
      </div>
      <div ref={dropdownRef} className="overflow-hidden" style={{ height: 0, opacity: 0 }}>
        <div className="mt-2 bg-dropdown-element-bg dark:bg-dropdown-element-dark-bg rounded-md shadow-lg border border-dropdown-border dark:border-dropdown-border">
          {elements.map((element, index) => (
            <div
              key={index}
              className={clsx(
                "p-2 hover:bg-dropdown-element-hover-bg dark:hover:bg-dropdown-element-dark-hover-bg cursor-pointer transition-colors text-dropdown-element-text dark:text-dropdown-element-dark-text",
                selectedElement === element
                  ? "bg-dropdown-element-hover-bg dark:bg-dropdown-element-dark-hover-bg"
                  : "",
              )}
              onClick={() => handleSelect(element)}
            >
              {element}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DropDown
