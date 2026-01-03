import { forwardRef, useImperativeHandle, useRef, useCallback, memo, useEffect } from "react"
import { store } from "../../../wailsjs/go/models"
import { MessageItem } from "./MessageItem"

interface MessageListProps {
  chatId: string
  messages: store.Message[]
  sentMediaCache: React.MutableRefObject<Map<string, string>>
  onReply?: (message: store.Message) => void
  onQuotedClick?: (messageId: string) => void
  onLoadMore?: () => void
  onAtBottomChange?: (atBottom: boolean) => void
  isLoading?: boolean
  hasMore?: boolean
  highlightedMessageId?: string | null
}

export interface MessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth") => void
  scrollToMessage: (messageId: string) => void
}

const MemoizedMessageItem = memo(MessageItem)

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  {
    chatId,
    messages,
    sentMediaCache,
    onReply,
    onQuotedClick,
    onLoadMore,
    onAtBottomChange,
    isLoading,
    hasMore,
    highlightedMessageId,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const minScrollTopRef = useRef<number>(Infinity)

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "smooth") => {
    const el = containerRef.current
    if (el) {
      const top = el.scrollHeight - el.clientHeight
      try {
        el.scrollTo({ top, behavior })
      } catch {
        el.scrollTop = top
      }
    }
  }, [])

  const scrollToMessage = useCallback((messageId: string) => {
    const el = containerRef.current
    if (!el) return

    const messageElement = el.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [])

  useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }))

  useEffect(() => {
    // Scroll to bottom on mount
    if (containerRef.current && messages.length > 0) {
      const el = containerRef.current
      el.scrollTop = el.scrollHeight
    }
  }, [])

  useEffect(() => {
    minScrollTopRef.current = Infinity
  }, [messages.length])

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget

      minScrollTopRef.current = Math.min(minScrollTopRef.current, el.scrollTop)

      // Trigger load more when ~2 messages are left above viewport (assuming ~100px per message)
      // Check both current position and minimum reached to catch fast scrolling
      if (
        (el.scrollTop <= 200 || minScrollTopRef.current <= 200) &&
        !isLoading &&
        hasMore &&
        onLoadMore
      ) {
        onLoadMore()
        // Reset after triggering load
        minScrollTopRef.current = Infinity
      }

      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 5
      onAtBottomChange?.(atBottom)
    },
    [isLoading, hasMore, onLoadMore, onAtBottomChange],
  )

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="h-full overflow-y-auto bg-repeat virtuoso-scroller"
      style={{ backgroundImage: "url('/assets/images/bg-chat-tile-dark.png')" }}
    >
      <div className="flex justify-center py-4">
        {isLoading ? (
          <div className="animate-spin h-5 w-5 border-2 border-green-500 rounded-full border-t-transparent" />
        ) : null}
      </div>
      {messages.map(msg => (
        <div key={msg.Info.ID} data-message-id={msg.Info.ID} className="px-4 py-1">
          <MemoizedMessageItem
            message={msg}
            chatId={chatId}
            sentMediaCache={sentMediaCache}
            onReply={onReply}
            onQuotedClick={onQuotedClick}
            highlightedMessageId={highlightedMessageId}
          />
        </div>
      ))}
    </div>
  )
})
