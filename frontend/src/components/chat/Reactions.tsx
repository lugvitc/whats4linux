import { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { store } from "../../../wailsjs/go/models"
import { GetCachedAvatar } from "../../../wailsjs/go/api/Api"
import { useContactStore } from "../../store/useContactStore"
import { isMe } from "../../lib/self"
import { formatPhone, phoneFromJID } from "../../lib/utils"
import { UserAvatar } from "../../assets/svgs/chat_icons"
import clsx from "clsx"

interface ReactionsProps {
  reactions: store.Reaction[]
  isFromMe: boolean
  onClick?: () => void
}

interface GroupedReaction {
  emoji: string
  senders: string[]
}

export function ReactionBubble({ reactions, isFromMe, onClick }: ReactionsProps) {
  if (!reactions || reactions.length === 0) return null

  const { groupedReactions } = useMemo(() => {
    const map = new Map<string, GroupedReaction>()

    for (const reaction of reactions) {
      const existing = map.get(reaction.emoji)

      if (existing) {
        existing.senders.push(reaction.sender_id)
      } else {
        map.set(reaction.emoji, {
          emoji: reaction.emoji,
          senders: [reaction.sender_id],
        })
      }
    }

    return { groupedReactions: Array.from(map.values()) }
  }, [reactions])

  return (
    <div className={clsx("mt-1", isFromMe ? "flex justify-end" : "flex justify-start")}>
      <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs shadow-sm bg-white dark:bg-dark-tertiary">
        <div className="flex items-center gap-1">
          {groupedReactions.map(reaction => (
            <span key={reaction.emoji} className="inline-flex items-center gap-1">
              <span className="text-sm leading-none">{reaction.emoji}</span>
              {reaction.senders.length > 1 && (
                <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                  {reaction.senders.length}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

interface ReactorRowProps {
  jid: string
}

function ReactorRow({ jid }: ReactorRowProps) {
  const self = isMe(jid)
  const [name, setName] = useState(self ? "You" : "")
  const [avatar, setAvatar] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    if (!self) {
      useContactStore
        .getState()
        .getSenderInfo(jid)
        .then(({ name: n }) => {
          if (live && n) setName(n)
        })
        .catch(() => {})
    }
    if (jid !== "me") {
      GetCachedAvatar(jid, false)
        .then(u => {
          if (live) setAvatar(u || null)
        })
        .catch(() => {})
    }
    return () => {
      live = false
    }
  }, [jid, self])

  const fallback =
    name ||
    (jid === "me" ? "You" : formatPhone(phoneFromJID(jid)) || jid.split("@")[0].split(":")[0])

  return (
    <div className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-tertiary">
      <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 shrink-0 flex items-center justify-center text-gray-500 dark:text-gray-400 [&_svg]:w-5 [&_svg]:h-5">
        {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : <UserAvatar />}
      </div>
      <span className="flex-1 min-w-0 truncate text-sm text-gray-900 dark:text-gray-100">
        {fallback}
      </span>
    </div>
  )
}

interface ReactionDetailsProps {
  reactions: store.Reaction[]
  isFromMe: boolean
  messageText?: string
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

export function ReactionDetails({
  reactions,
  isFromMe,
  messageText,
  anchorRef,
  onClose,
}: ReactionDetailsProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedReaction>()
    for (const reaction of reactions) {
      const existing = map.get(reaction.emoji)
      if (existing) existing.senders.push(reaction.sender_id)
      else map.set(reaction.emoji, { emoji: reaction.emoji, senders: [reaction.sender_id] })
    }
    return Array.from(map.values())
  }, [reactions])

  useLayoutEffect(() => {
    if (!anchorRef.current || !popRef.current) return
    const anchor = anchorRef.current.getBoundingClientRect()
    const pop = popRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 8

    let top = anchor.bottom + gap
    if (top + pop.height > vh && anchor.top - pop.height - gap > 0) {
      top = anchor.top - pop.height - gap
    }
    let left = isFromMe ? anchor.right - pop.width : anchor.left
    if (left + pop.width > vw) left = vw - pop.width - gap
    if (left < gap) left = gap

    setPosition({ top, left })
  }, [anchorRef, isFromMe, grouped])

  useEffect(() => {
    if (!anchorRef.current) return
    const popEl = popRef.current

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (popEl?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    const handleScroll = () => onClose()

    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("scroll", handleScroll, true)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [anchorRef, onClose])

  return createPortal(
    <div
      ref={popRef}
      className="fixed z-9999 w-80 max-h-[60vh] overflow-y-auto rounded-xl bg-white dark:bg-dark-secondary shadow-xl border border-black/5 dark:border-white/5"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="sticky top-0 bg-white dark:bg-dark-secondary z-10 px-4 pt-3 pb-2 border-b border-gray-200 dark:border-dark-tertiary">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Reactions</p>
        {messageText && (
          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 wrap-break-word">
            {messageText}
          </p>
        )}
      </div>
      <div className="p-2">
        {grouped.map(group => (
          <div key={group.emoji} className="mb-1">
            <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
              <span className="text-sm leading-none">{group.emoji}</span>
              <span>{group.senders.length}</span>
            </div>
            {group.senders.map(jid => (
              <ReactorRow key={jid} jid={jid} />
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
