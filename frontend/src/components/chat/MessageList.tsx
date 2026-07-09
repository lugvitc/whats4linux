import { forwardRef, useImperativeHandle, useRef, memo } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { store } from "../../../wailsjs/go/models"
import { MessageItem } from "./MessageItem"

interface MessageListProps {
  chatId: string
  messages: store.DecodedMessage[]
  // Virtuoso anchor for prepending older messages without a scroll jump: it
  // decreases by the number of messages prepended (see ChatDetail).
  firstItemIndex: number
  sentMediaCache: React.MutableRefObject<Map<string, string>>
  onReply?: (message: store.DecodedMessage) => void
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
    firstItemIndex,
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
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior: "auto" | "smooth" = "smooth") => {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior })
      },
      scrollToMessage: (messageId: string) => {
        const index = messages.findIndex(m => m.Info.ID === messageId)
        if (index >= 0) {
          virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" })
        }
      },
    }),
    [messages],
  )

  return (
    <Virtuoso
      ref={virtuosoRef}
      className="h-full virtuoso-scroller"
      data={messages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={Math.max(0, messages.length - 1)}
      // A modest buffer keeps rows ready just ahead of the viewport without
      // mounting so many expensive rows that scrolling itself gets costly.
      increaseViewportBy={{ top: 200, bottom: 200 }}
      // Fires when the user scrolls to the very top -> load older messages.
      startReached={() => {
        if (hasMore && !isLoading) onLoadMore?.()
      }}
      atBottomStateChange={atBottom => onAtBottomChange?.(atBottom)}
      // Stick to the bottom for new messages only when already at the bottom.
      followOutput={atBottom => (atBottom ? "smooth" : false)}
      computeItemKey={(_index, msg) => msg?.Info?.ID ?? String(_index)}
      components={{
        Header: () =>
          isLoading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin h-5 w-5 border-2 border-green-500 rounded-full border-t-transparent" />
            </div>
          ) : null,
      }}
      itemContent={(_index, msg) => (
        <div data-message-id={msg.Info.ID} className="py-1 overflow-x-hidden">
          <MemoizedMessageItem
            message={msg}
            chatId={chatId}
            sentMediaCache={sentMediaCache}
            onReply={onReply}
            onQuotedClick={onQuotedClick}
            highlightedMessageId={highlightedMessageId}
          />
        </div>
      )}
    />
  )
})
