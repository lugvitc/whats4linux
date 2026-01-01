import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { forwardRef, useImperativeHandle, useRef, useCallback, memo } from "react"
import { store } from "../../../wailsjs/go/models"
import { MessageItem } from "./MessageItem"

interface MessageListProps {
  chatId: string
  messages: store.Message[]
  sentMediaCache: React.MutableRefObject<Map<string, string>>
  onReply?: (message: store.Message) => void
  onLoadMore?: () => void
  firstItemIndex: number
  isLoading?: boolean
  hasMore?: boolean
}

export interface MessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth") => void
}

// Memoized message item to prevent unnecessary re-renders
const MemoizedMessageItem = memo(MessageItem)

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  { chatId, messages, sentMediaCache, onReply, onLoadMore, firstItemIndex, isLoading, hasMore },
  ref,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const scrollToBottom = useCallback(
    (behavior: "auto" | "smooth" = "smooth") => {
      if (virtuosoRef.current && messages.length > 0) {
        virtuosoRef.current.scrollToIndex({
          index: messages.length - 1,
          align: "end",
          behavior,
        })
      }
    },
    [messages.length],
  )

  useImperativeHandle(ref, () => ({
    scrollToBottom,
  }))

  // Handle reaching the top - load more messages
  const handleStartReached = useCallback(() => {
    if (!isLoading && hasMore && onLoadMore) {
      onLoadMore()
    }
  }, [isLoading, hasMore, onLoadMore])

  // Loading indicator component
  const LoadingHeader = useCallback(
    () => (
      <div className="flex justify-center py-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-500">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading messages...</span>
          </div>
        ) : hasMore ? (
          <div className="h-2" />
        ) : (
          <div className="text-xs text-gray-500 py-2">Beginning of conversation</div>
        )}
      </div>
    ),
    [isLoading, hasMore],
  )

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={messages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={messages.length - 1}
      startReached={handleStartReached}
      followOutput="smooth"
      alignToBottom
      increaseViewportBy={{ top: 200, bottom: 0 }}
      className="flex-1 overflow-y-auto bg-repeat"
      style={{ backgroundImage: "url('/assets/images/bg-chat-tile-dark.png')" }}
      itemContent={(_, msg) => (
        <div className="px-4 py-1">
          <MemoizedMessageItem
            message={msg}
            chatId={chatId}
            sentMediaCache={sentMediaCache}
            onReply={onReply}
          />
        </div>
      )}
      components={{
        Header: LoadingHeader,
        Footer: () => <div className="h-2" />,
      }}
    />
  )
})
