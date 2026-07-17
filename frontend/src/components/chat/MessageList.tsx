import { forwardRef, useImperativeHandle, useRef, memo } from "react"
import { Virtuoso, type VirtuosoHandle, type Components } from "react-virtuoso"
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

// Mount rows well before they enter the viewport so row mount work (media
// placeholders, contact lookups) happens off-screen instead of mid-scroll.
const OVERSCAN = { top: 800, bottom: 800 }

interface ListContext {
  isLoading?: boolean
}

// Components must be stable module-level references: an inline object/arrow
// recreated per render makes Virtuoso remount them on every parent re-render
// (which happens mid-scroll via atBottomStateChange), causing visible hitches.
const ListHeader: Components<store.DecodedMessage, ListContext>["Header"] = ({ context }) =>
  context?.isLoading ? (
    <div className="flex justify-center py-4">
      <div className="animate-spin h-5 w-5 border-2 border-green-500 rounded-full border-t-transparent" />
    </div>
  ) : null

// Breathing room between the last message and the composer.
const ListFooter: Components<store.DecodedMessage, ListContext>["Footer"] = () => (
  <div className="h-2" />
)

const listComponents: Components<store.DecodedMessage, ListContext> = {
  Header: ListHeader,
  Footer: ListFooter,
}

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
      increaseViewportBy={OVERSCAN}
      // Fires when the user scrolls to the very top -> load older messages.
      startReached={() => {
        if (hasMore && !isLoading) onLoadMore?.()
      }}
      atBottomStateChange={atBottom => onAtBottomChange?.(atBottom)}
      // Stick to the bottom for new messages only when already at the bottom.
      // "auto" (instant) rather than "smooth": animated follow fights with
      // fast incoming updates and produces janky rubber-banding.
      followOutput={atBottom => (atBottom ? "auto" : false)}
      computeItemKey={(_index, msg) => msg?.Info?.ID ?? String(_index)}
      context={{ isLoading }}
      components={listComponents}
      itemContent={(_index, msg) => {
        // WhatsApp-style grouping: consecutive messages from the same sender
        // form a run — only the first shows the sender name/avatar, and runs
        // are separated by a larger gap than messages within a run.
        const prev = messages[_index - firstItemIndex - 1]
        const firstInGroup =
          !prev ||
          prev.Info.IsFromMe !== msg.Info.IsFromMe ||
          prev.Info.Sender !== msg.Info.Sender
        // No overflow-hidden on the row: hiding one axis forces the other to
        // 'auto', which clips the reaction pills that hang below bubbles.
        // Horizontal overflow is already contained at the panel level.
        return (
          <div data-message-id={msg.Info.ID} className={firstInGroup ? "pt-2 pb-px" : "py-px"}>
            <MemoizedMessageItem
              message={msg}
              chatId={chatId}
              firstInGroup={firstInGroup}
              sentMediaCache={sentMediaCache}
              onReply={onReply}
              onQuotedClick={onQuotedClick}
              highlightedMessageId={highlightedMessageId}
            />
          </div>
        )
      }}
    />
  )
})
