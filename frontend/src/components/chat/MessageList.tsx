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
  getScrollHeight: () => number
  getScrollTop: () => number
  setScrollTop: (top: number) => void
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
  const loadMoreTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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

  const getScrollHeight = useCallback(() => {
    const el = containerRef.current
    return el ? el.scrollHeight : 0
  }, [])

  const getScrollTop = useCallback(() => {
    const el = containerRef.current
    return el ? el.scrollTop : 0
  }, [])

  const setScrollTop = useCallback((top: number) => {
    const el = containerRef.current
    if (el) {
      el.scrollTop = top
    }
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToBottom,
    scrollToMessage,
    getScrollHeight,
    getScrollTop,
    setScrollTop,
  }))

  useEffect(() => {
    return () => {
      if (loadMoreTimeoutRef.current) {
        clearTimeout(loadMoreTimeoutRef.current)
      }
    }
  }, [])


  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget

      // Clear existing timeout
      if (loadMoreTimeoutRef.current) {
        clearTimeout(loadMoreTimeoutRef.current)
      }

      // Check if we should load more
      const shouldLoadMore = el.scrollTop === 0 && !isLoading && hasMore && onLoadMore

      if (shouldLoadMore) {
        // Set timeout to load more after scrolling stops
        loadMoreTimeoutRef.current = setTimeout(() => {
          onLoadMore()
          loadMoreTimeoutRef.current = null
        }, 300) // Wait 300ms after scrolling stops
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
      className="h-full overflow-y-auto overflow-x-hidden bg-repeat virtuoso-scroller"
      style={{ backgroundImage: "url('/assets/images/bg-chat-tile-dark.png')" }}
    >
      <div className="flex justify-center py-4">
        {isLoading ? (
          <div className="animate-spin h-5 w-5 border-2 border-green-500 rounded-full border-t-transparent" />
        ) : null}
      </div>
      {messages.map(msg => (
        <div key={msg.Info.ID} data-message-id={msg.Info.ID} className="px-2 py-1 sm:px-4 overflow-x-hidden">
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
