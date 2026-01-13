import  { useMemo } from "react"
import { store } from "../../../wailsjs/go/models"
import clsx from "clsx"

interface ReactionsProps {
  reactions: store.Reaction[]
  isFromMe: boolean
}

interface GroupedReaction {
  emoji: string
  senders: string[]
}

export function ReactionBubble({ reactions, isFromMe }: ReactionsProps) {
  if (!reactions || reactions.length === 0) return null

  const { groupedReactions, totalReactions } = useMemo(() => {
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

    const groupedReactions = Array.from(map.values())

    return {
      groupedReactions,
      totalReactions: reactions.length,
    }
  }, [reactions])

  return (
    <div
      className={clsx(
        "mt-1",
        isFromMe ? "flex justify-end" : "flex justify-start",
      )}
    >
      <div
        className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs shadow-sm bg-white dark:bg-dark-tertiary"
      >
        <div className="flex items-center gap-1">
          {groupedReactions.map(reaction => (
            <span
              key={reaction.emoji}
              className="inline-flex items-center gap-0.5"
            >
              <span className="text-sm leading-none">
                {reaction.emoji}
              </span>
            </span>
          ))}
        </div>

        <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">
          {totalReactions}
        </span>
      </div>
    </div>
  )
}
