import { useState, useRef, useEffect } from "react"
import {
  ReplyIcon,
  ReplyPrivatelyIcon,
  MessageIcon,
  CopyIcon,
  ReactIcon,
  ForwardIcon,
  StarIcon,
  ReportIcon,
  DeleteIcon,
  MenuArrowIcon,
} from "../../assets/svgs/message_menu_icons"

interface MessageMenuProps {
  messageId: string
  isFromMe: boolean
  onReply?: () => void
  onReplyPrivately?: () => void
  onMessage?: () => void
  onCopy?: () => void
  onReact?: () => void
  onForward?: () => void
  onStar?: () => void
  onReport?: () => void
  onDelete?: () => void
}

export function MessageMenu({
  messageId,
  isFromMe,
  onReply,
  onReplyPrivately,
  onMessage,
  onCopy,
  onReact,
  onForward,
  onStar,
  onReport,
  onDelete,
}: MessageMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const closeMenu = () => {
    setIsClosing(true)
    setTimeout(() => {
      setIsMenuOpen(false)
      setIsClosing(false)
    }, 150)
  }

  // if menu should open upward or downward
  useEffect(() => {
    if (isMenuOpen && menuRef.current && dropdownRef.current) {
      const buttonRect = menuRef.current.getBoundingClientRect()
      const dropdownHeight = dropdownRef.current.offsetHeight
      const viewportHeight = window.innerHeight
      const spaceBelow = viewportHeight - buttonRect.bottom
      const spaceAbove = buttonRect.top

      if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
        setOpenUpward(true)
      } else {
        setOpenUpward(false)
      }
    }
  }, [isMenuOpen])

  // close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
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
      {isMenuOpen && (
        <div
          ref={dropdownRef}
          className={`absolute ${isFromMe ? "right-0" : "left-0"} ${openUpward ? "bottom-full mb-1" : "mt-1"} w-56 bg-white dark:bg-[#233138] rounded-xl shadow-lg z-50 py-1 border border-gray-200 dark:border-gray-700`}
          style={{
            animation: isClosing ? "menuFadeOut 0.15s ease-in" : "menuFadeIn 0.15s ease-out",
          }}
        >
          <button
            onClick={() => handleMenuItemClick(onReply)}
            className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
          >
            <ReplyIcon />
            <span>Reply</span>
          </button>

          {!isFromMe && onReplyPrivately && (
            <button
              onClick={() => handleMenuItemClick(onReplyPrivately)}
              className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
            >
              <ReplyPrivatelyIcon />
              <span>Reply privately</span>
            </button>
          )}

          {!isFromMe && onMessage && (
            <button
              onClick={() => handleMenuItemClick(onMessage)}
              className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
            >
              <MessageIcon />
              <span>Message</span>
            </button>
          )}

          <button
            onClick={() => handleMenuItemClick(onCopy)}
            className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
          >
            <CopyIcon />
            <span>Copy</span>
          </button>

          <button
            onClick={() => handleMenuItemClick(onReact)}
            className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
          >
            <ReactIcon />
            <span>React</span>
          </button>

          <button
            onClick={() => handleMenuItemClick(onForward)}
            className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
          >
            <ForwardIcon />
            <span>Forward</span>
          </button>

          <button
            onClick={() => handleMenuItemClick(onStar)}
            className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
          >
            <StarIcon />
            <span>Star</span>
          </button>

          {!isFromMe && onReport && (
            <button
              onClick={() => handleMenuItemClick(onReport)}
              className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
            >
              <ReportIcon />
              <span>Report</span>
            </button>
          )}

          <button
            onClick={() => handleMenuItemClick(onDelete)}
            className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#182229] transition-colors text-gray-800 dark:text-gray-200 text-sm"
          >
            <DeleteIcon />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  )
}
