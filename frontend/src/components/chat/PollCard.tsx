import { useEffect, useState } from "react"
import { useUIStore } from "../../store"
import { SendPollVote } from "../../../wailsjs/go/api/Api"
import { store } from "../../../wailsjs/go/models"
import clsx from "clsx"
import { isMe } from "../../lib/self"
import { useCachedAvatar } from "../../lib/useCachedAvatar"
import { UserAvatar } from "../../assets/svgs/chat_icons"

interface PollCardProps {
  pollName: string
  options: string[]
  selectableCount: number
  messageId: string
  votes?: store.PollVote[]
}

const MAX_VOTER_AVATARS = 2

const CHECK_DATA_URI =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23ffffff%22%20stroke-width=%223%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M20%206%209%2017l-5-5%22/%3E%3C/svg%3E"

export function PollCard({ pollName, options, selectableCount, messageId, votes }: PollCardProps) {
  const validVotes = (votes || []).filter(v => (v.options || []).length > 0)
  const myVote = validVotes.find(v => isMe(v.sender_jid))
  const [selected, setSelected] = useState<Set<number>>(() => myVoteOptions(myVote, options))
  const [voted, setVoted] = useState(!!myVote)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  // Reflect the latest vote state from the server (ours or others). Runs when
  // myVote changes — after this app votes, the phone votes, or an echo returns.
  useEffect(() => {
    const fromVote = myVoteOptions(myVote, options)
    setSelected(fromVote)
    setVoted(fromVote.size > 0)
  }, [myVote, options])

  const multiSelect = selectableCount !== 1

  const sendVote = async (optionIndexes: number[], nextSelection: Set<number>) => {
    if (sending) return
    setSending(true)
    setError("")
    setSelected(nextSelection) // optimistic UI while the send is in flight
    try {
      await SendPollVote(
        messageId,
        optionIndexes.map(i => options[i]),
      )
      setSelected(new Set(optionIndexes))
      setVoted(optionIndexes.length > 0)
    } catch (err) {
      console.error("Failed to vote on poll:", err)
      setError(String(err))
    } finally {
      setSending(false)
    }
  }

  const toggleOption = (i: number) => {
    if (sending) return
    if (!multiSelect) {
      if (selected.has(i)) {
        sendVote([], new Set())
      } else {
        sendVote([i], new Set([i]))
      }
      return
    }
    const next = new Set(selected)
    if (next.has(i)) {
      next.delete(i)
    } else {
      if (selectableCount > 0 && next.size >= selectableCount) {
        return
      }
      next.add(i)
    }
    sendVote(Array.from(next), next)
  }

  const votesForOption = (opt: string) => validVotes.filter(v => v.options.includes(opt))

  const counts = options.map(o => votesForOption(o).length)
  const totalVotes = validVotes.length
  const showResults = totalVotes > 0

  const dotCls = clsx(
    "control appearance-none pointer-events-none shrink-0 w-[18px] h-[18px] border-2 transition-colors",
    "bg-no-repeat bg-center",
    multiSelect ? "rounded-[5px]" : "rounded-full",
    "border-[#8696a0] dark:border-white/30",
    "checked:border-[#21c063]",
    multiSelect
      ? "checked:bg-[#21c063] bg-[length:13px_13px] checked:bg-[url('" + CHECK_DATA_URI + "')]"
      : "bg-[length:10px_10px] checked:bg-[radial-gradient(circle,#21c063_0%,#21c063_45%,transparent_50%)]",
  )

  return (
    <div className="w-full min-w-[240px]">
      <div className="font-medium text-sm mb-0.5">{pollName}</div>
      <div className="text-xs text-black/40 dark:text-white/40 mb-1.5">
        {multiSelect ? "Select one or more" : "Select one"}
      </div>
      <div className="flex flex-col gap-1.5">
        {options.map((opt, i) => {
          const count = counts[i]
          const voters = showResults ? votesForOption(opt) : []
          const percent = showResults ? Math.round((count / totalVotes) * 100) : 0
          const shownVoters = voters.slice(0, MAX_VOTER_AVATARS)
          const more = voters.length - shownVoters.length
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggleOption(i)}
              disabled={sending}
              className={clsx(
                "relative flex flex-col gap-1.5 w-full px-3 py-2 rounded-lg text-left text-sm transition-colors border",
                "border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 active:bg-black/10 dark:active:bg-white/10 cursor-pointer",
                selected.has(i) && "border-[#21c063]/60",
              )}
            >
              <div className="relative z-[1] flex items-center gap-2">
                <input
                  type={multiSelect ? "checkbox" : "radio"}
                  checked={selected.has(i)}
                  onChange={() => toggleOption(i)}
                  readOnly
                  tabIndex={-1}
                  className={dotCls}
                />
                <span className="flex-1">{opt}</span>
                {voters.length > 0 && (
                  <>
                    <div className="flex items-center -space-x-1.5 shrink-0">
                      {shownVoters.map(v => (
                        <VoterAvatar key={v.sender_jid} jid={v.sender_jid} />
                      ))}
                    </div>
                    {more > 0 && (
                      <span className="text-xs tabular-nums text-black/50 dark:text-white/40 shrink-0">
                        +{more}
                      </span>
                    )}
                  </>
                )}
                {showResults && count > 0 && (
                  <span className="text-xs tabular-nums text-black/40 dark:text-white/40 shrink-0">
                    {count}
                  </span>
                )}
              </div>
              {showResults && (
                <div className="relative z-[1] ml-6">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#21c063]"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>
      {error && <div className="mt-2 text-xs text-red-500 break-words">{error}</div>}
      <button
        type="button"
        onClick={() => voted && useUIStore.getState().setPollResultsFor(messageId)}
        disabled={!voted}
        className={clsx(
          "mt-2 w-full py-1.5 rounded-lg text-sm font-medium transition-colors",
          voted
            ? "text-[#21c063] hover:bg-black/5 dark:hover:bg-white/5"
            : "text-black/25 dark:text-white/25 cursor-not-allowed",
        )}
      >
        View votes
      </button>
    </div>
  )
}

function VoterAvatar({ jid }: { jid: string }) {
  const avatar = useCachedAvatar(jid)

  return (
    <span className="w-[22px] h-[22px] rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-400 [&_svg]:w-3.5 [&_svg]:h-3.5 shrink-0 ring-2 ring-[#1f2d36]/[0.85] dark:ring-[#0b141a]">
      {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : <UserAvatar />}
    </span>
  )
}

function myVoteOptions(myVote: store.PollVote | undefined, options: string[]): Set<number> {
  if (!myVote || !myVote.options) return new Set()
  return new Set(myVote.options.map(o => options.indexOf(o)).filter(i => i >= 0))
}
