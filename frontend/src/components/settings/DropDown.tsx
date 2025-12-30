import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { useState, useRef, useEffect } from "react"

const DropDown = ({
  title,
  elements,
  icon,
  onToggle,
}: {
  title: string
  elements: string[]
  icon?: React.ReactNode
  onToggle: (element: string) => void
}) => {
  const [onOpen, setOnOpen] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const arrowRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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
    if (dropdownRef.current && arrowRef.current) {
      if (onOpen) {
        gsap.to(dropdownRef.current, {
          height: "auto",
          opacity: 1,
          duration: 0.3,
          ease: "power2.out",
        })
        gsap.to(arrowRef.current, {
          rotation: 180,
          duration: 0.3,
          ease: "power2.out",
        })
      } else {
        gsap.to(dropdownRef.current, {
          height: 0,
          opacity: 0,
          duration: 0.3,
          ease: "power2.in",
        })
        gsap.to(arrowRef.current, {
          rotation: 0,
          duration: 0.3,
          ease: "power2.in",
        })
      }
    }
  }, [onOpen])

  return (
    <div ref={containerRef} className="flex flex-col">
      <div className="font-semibold mb-2">{title}</div>
      <div
        className="cursor-pointer flex items-center justify-between p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors border border-white/50"
        onClick={toggleOpen}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span>{selectedElement || "Select an option"}</span>
        </div>
        <span ref={arrowRef} className="inline-block">
          ▼
        </span>
      </div>
      <div ref={dropdownRef} className="overflow-hidden" style={{ height: 0, opacity: 0 }}>
        <div className="mt-2 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700">
          {elements.map((element, index) => (
            <div
              key={index}
              className={`p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors ${
                selectedElement === element ? "bg-gray-100 dark:bg-gray-700" : ""
              }`}
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
