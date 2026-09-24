import { useEffect, useState } from "react"
import { GetGroupInfo } from "../../../wailsjs/go/api/Api"
import { store } from "../../../wailsjs/go/models"
import clsx from "clsx"
import { isMe, userPart } from "../../lib/self"
import { formatPhone, phoneFromJID } from "../../lib/utils"
import { useContactStore } from "../../store/useContactStore"
import { useCachedAvatar } from "../../lib/useCachedAvatar"
import { UserAvatar } from "../../assets/svgs/chat_icons"

interface PollVotesSidebarProps {
  poll: store.PollInfo | null
  isOpen: boolean
  onClose: () => void
  chatId: string
  chatType: string
}

export function PollVotesSidebar({
  poll,
  isOpen,
  onClose,
  chatId,
  chatType,
}: PollVotesSidebarProps) {
  const [names, setNames] = useState<Record<string, string>>({})
  const [memberCount, setMemberCount] = useState(0)
  const votes = poll?.votes || []
  const validVotes = votes.filter(v => (v.options || []).length > 0)

  useEffect(() => {
    if (!isOpen) return
    let live = true
    const jids = new Set<string>()
    votes.forEach(v => {
      if (v?.sender_jid) jids.add(v.sender_jid)
    })
    Promise.all(
      Array.from(jids).map(async jid => {
        try {
          const { name } = await useContactStore.getState().getSenderInfo(jid)
          return [jid, name] as const
        } catch {
          return [jid, ""] as const
        }
      }),
    ).then(pairs => {
      if (live) setNames(Object.fromEntries(pairs))
    })
    return () => {
      live = false
    }
  }, [isOpen, votes])

  useEffect(() => {
    if (!isOpen || !poll || chatType !== "group") {
      setMemberCount(0)
      return
    }
    let live = true
    GetGroupInfo(chatId)
      .then(gi => {
        if (live) setMemberCount(gi?.participant_count || 0)
      })
      .catch(() => {
        if (live) setMemberCount(0)
      })
    return () => {
      live = false
    }
  }, [isOpen, poll, chatId, chatType])

  if (!isOpen || !poll) return null

  const totalVotes = validVotes.length
  const counts = poll.options.map(o => validVotes.filter(v => v.options.includes(o)).length)
  const maxCount = Math.max(0, ...counts)
  const winning = new Set(poll.options.filter((_, i) => counts[i] === maxCount && maxCount > 0))
  const sortedIds = poll.options.map((_, i) => i).sort((a, b) => counts[b] - counts[a])
  const members = chatType === "group" ? memberCount : chatType === "contact" ? 2 : 0

  const displayName = (jid: string) => {
    if (isMe(jid)) return "You"
    const n = names[jid]
    if (n && n.trim()) return n.trim()
    return formatPhone(phoneFromJID(jid)) || userPart(jid)
  }

  return (
    <div className="w-full md:w-[400px] h-full bg-white dark:bg-[#111b21] border-l border-gray-300 dark:border-[#222d34] flex flex-col overflow-hidden">
      <div className="flex items-center p-4 bg-light-secondary dark:bg-[#1f2c33]">
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors mr-3"
          aria-label="Close"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            className="fill-current text-black/70 dark:text-white/70"
          >
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Poll details</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <div className="font-medium text-base mb-1 text-black dark:text-white">{poll.name}</div>

          {members > 0 ? (
            <div className="text-sm text-black/40 dark:text-white/40 mb-4">
              {totalVotes} of {members} members voted
            </div>
          ) : totalVotes > 0 ? (
            <div className="text-sm text-black/40 dark:text-white/40 mb-4">
              {totalVotes} vote{totalVotes === 1 ? "" : "s"}
            </div>
          ) : null}

          <div className="flex flex-col gap-5">
            {sortedIds.map(i => {
              const opt = poll.options[i]
              const count = counts[i]
              const voters = validVotes.filter(v => v.options.includes(opt))
              const isWinner = winning.has(opt)
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-black dark:text-white">{opt}</span>
                    {count > 0 && (
                      <span
                        className={clsx(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          isWinner
                            ? "bg-[#005c4b] text-white"
                            : "bg-black/10 dark:bg-white/10 text-black/60 dark:text-white/60",
                        )}
                      >
                        {count} vote{count === 1 ? "" : "s"}
                        {isWinner && " ★"}
                      </span>
                    )}
                  </div>
                  {voters.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {voters.map(v => (
                        <VoterRow
                          key={v.sender_jid}
                          jid={v.sender_jid}
                          name={displayName(v.sender_jid)}
                          votedAt={v.updated_at}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-black/30 dark:text-white/30 pl-1">
                      No votes yet
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatVoteTime(ts: number): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ""
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const time24 = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  if (msgDay.getTime() === today.getTime()) return "Today at " + time24
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday at " + time24
  return (
    d.toLocaleDateString([], { day: "numeric", month: "numeric", year: "numeric" }) + " " + time24
  )
}

function VoterRow({ jid, name, votedAt }: { jid: string; name: string; votedAt?: number }) {
  const avatar = useCachedAvatar(jid)
  const time = formatVoteTime(votedAt || 0)

  return (
    <div className="flex items-start gap-3 py-1 px-1">
      <span className="w-10 h-10 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-400 [&_svg]:w-5 [&_svg]:h-5 shrink-0">
        {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : <UserAvatar />}
      </span>
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-black dark:text-white truncate">{name}</span>
        {time && <span className="text-xs text-black/40 dark:text-white/40">{time}</span>}
      </div>
    </div>
  )
}
