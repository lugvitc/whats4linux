import { useState, useRef, useEffect, useLayoutEffect } from "react"
import { createPortal } from "react-dom"
import { ReplyIcon, CopyIcon, ReactIcon, MenuArrowIcon, EditIcon } from "../../assets/svgs/message_menu_icons"

interface MessageMenuProps {
  messageId: string
  isFromMe: boolean
  isPinned?: boolean
  onReply?: () => void
  onCopy?: () => void
  onReact?: () => void
  onPin?: () => void
  onEdit?: () => void
}

// Same pin glyph as the chat list, sized for menu rows.
const PinMenuIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" className="fill-current">
    <path d="M16 3a1 1 0 0 1 .95 1.31l-.9 2.72 3.42 3.42a1 1 0 0 1-.21 1.57l-3.62 2.07-1.9 4.75a1 1 0 0 1-1.64.33L9 16.07l-4.29 4.3-1.42-1.42 4.3-4.29-3.1-3.1a1 1 0 0 1 .33-1.64l4.75-1.9 2.07-3.62A1 1 0 0 1 12.5 4z" />
  </svg>
)

export function MessageMenu({
  messageId,
  isFromMe,
  isPinned,
  onReply,
  onCopy,
  onReact,
  onPin,
  onEdit
}: MessageMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{
    top: number
    left: number
    transformOrigin: string
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const closeMenu = () => {
    setIsClosing(true)
    setTimeout(() => {
      setIsMenuOpen(false)
      setIsClosing(false)
    }, 150)
  }

  useLayoutEffect(() => {
    if (isMenuOpen && menuRef.current && dropdownRef.current) {
      const buttonRect = menuRef.current.getBoundingClientRect()
      const dropdownRect = dropdownRef.current.getBoundingClientRect()
      const viewportHeight = window.innerHeight

      const spaceBelow = viewportHeight - buttonRect.bottom
      const spaceAbove = buttonRect.top
      const height = dropdownRect.height
      const width = dropdownRect.width

      let top = 0
      let left = 0
      let origin = "top right"

      let upward = false
      if (spaceBelow < height && spaceAbove > height) {
        upward = true
      }

      if (isFromMe) {
        left = buttonRect.right - width
      } else {
        left = buttonRect.left
      }

      if (upward) {
        top = buttonRect.top - height - 4
        origin = isFromMe ? "bottom right" : "bottom left"
      } else {
        top = buttonRect.bottom + 4
        origin = isFromMe ? "top right" : "top left"
      }

      setMenuPosition({ top, left, transformOrigin: origin })
    } else if (!isMenuOpen) {
      setMenuPosition(null)
    }
  }, [isMenuOpen, isFromMe])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }
    const handleScroll = () => {
      closeMenu()
    }

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      window.addEventListener("scroll", handleScroll, true)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [isMenuOpen])

  const handleMenuItemClick = (callback?: () => void) => {
    callback?.()
    closeMenu()
  }

  return (
    <div className="absolute top-1 right-1 z-10" ref={menuRef}>
      <button
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        className="opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer p-1"
        aria-label="Message options"
      >
        <MenuArrowIcon />
      </button>

      {/* menu */}
      {isMenuOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-56 bg-white dark:bg-dark-secondary rounded-xl shadow-lg p-2"
            style={{
              top: menuPosition?.top ?? 0,
              left: menuPosition?.left ?? 0,
              visibility: menuPosition ? "visible" : "hidden",
              transformOrigin: menuPosition?.transformOrigin,
              animation: isClosing ? "menuFadeOut 0.15s ease-in" : "menuFadeIn 0.15s ease-out",
            }}
          >
            <button
              onClick={() => handleMenuItemClick(onReply)}
              className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm"
            >
              <ReplyIcon />
              <span>Reply</span>
            </button>

            <button
              onClick={() => handleMenuItemClick(onReact)}
              className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm"
            >
              <ReactIcon />
              <span>React</span>
            </button>

            <button
              onClick={() => handleMenuItemClick(onEdit)}
              className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm"
            >
              <EditIcon />
              <span>Edit</span>
            </button>

            {onPin && (
              <button
                onClick={() => handleMenuItemClick(onPin)}
                className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm"
              >
                <PinMenuIcon />
                <span>{isPinned ? "Unpin" : "Pin"}</span>
              </button>
            )}

            <button
              onClick={() => handleMenuItemClick(onCopy)}
              className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm"
            >
              <CopyIcon />
              <span>Copy</span>
            </button>

          </div>,
          document.body,
        )}
    </div>
  )
}
