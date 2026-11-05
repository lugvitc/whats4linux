import { forwardRef, useImperativeHandle, useRef, memo, useMemo } from "react"
import { Virtuoso, type VirtuosoHandle, type Components } from "react-virtuoso"
import { store } from "../../../wailsjs/go/models"
import { MessageItem } from "./MessageItem"
import { dayKey, formatDateSeparator } from "../../lib/utils"

const TAG = "date"
type DateSeparatorEntry = { __t: typeof TAG; label: string; key: string }
type RowItem = store.DecodedMessage | DateSeparatorEntry

function isSep(r: RowItem): r is DateSeparatorEntry {
  return r != null && (r as DateSeparatorEntry).__t === TAG
}

interface MessageListProps {
  chatId: string
  messages: store.DecodedMessage[]
  firstItemIndex: number
  sentMediaCache: React.MutableRefObject<Map<string, string>>
  onReply?: (message: store.DecodedMessage) => void
  onEdit?: (message: store.DecodedMessage) => void
  onQuotedClick?: (messageId: string) => void
  onLoadMore?: () => void
  onAtBottomChange?: (atBottom: boolean) => void
  pinnedIds?: Set<string>
  isLoading?: boolean
  hasMore?: boolean
  highlightedMessageId?: string | null
}

export interface MessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth") => void
  scrollToMessage: (messageId: string) => boolean
}

const MemoizedMessageItem = memo(MessageItem)

const OVERSCAN = { top: 800, bottom: 800 }

interface ListContext {
  isLoading?: boolean
}

const ListHeader: Components<RowItem, ListContext>["Header"] = ({ context: ctx }) =>
  ctx?.isLoading ? (
    <div className="flex justify-center py-4">
      <div className="animate-spin h-5 w-5 border-2 border-green-500 rounded-full border-t-transparent" />
    </div>
  ) : null

const ListFooter: Components<RowItem, ListContext>["Footer"] = () => <div className="h-2" />

const listComponents: Components<RowItem, ListContext> = {
  Header: ListHeader,
  Footer: ListFooter,
}

const DateSeparator = memo(function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-2 select-none">
      <span className="rounded-full bg-white/80 dark:bg-white/10 px-3 py-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 shadow-sm">
        {label}
      </span>
    </div>
  )
})
DateSeparator.displayName = "DateSeparator"

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  {
    chatId,
    messages,
    firstItemIndex,
    sentMediaCache,
    onReply,
    onEdit,
    onQuotedClick,
    onLoadMore,
    onAtBottomChange,
    pinnedIds,
    isLoading,
    hasMore,
    highlightedMessageId,
  },
  ref,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const rows = useMemo<ReadonlyArray<RowItem>>(() => {
    const out: RowItem[] = []
    let prevDay = ""
    for (let i = 0; i < messages.length; i++) {
      const ts = messages[i]?.Info?.Timestamp
      const dk = ts ? dayKey(ts) : ""
      if (dk && dk !== prevDay) {
        prevDay = dk
        out.push({ __t: TAG, label: formatDateSeparator(dk), key: `d_${dk}` })
      }
      out.push(messages[i])
    }
    return out
  }, [messages])

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior: "auto" | "smooth" = "smooth") => {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior })
      },
      scrollToMessage: (messageId: string) => {
        const index = rows.findIndex(
          r => !isSep(r) && (r as store.DecodedMessage).Info?.ID === messageId,
        )
        if (index >= 0) {
          virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" })
          return true
        }
        return false
      },
    }),
    [rows],
  )

  return (
    <Virtuoso
      ref={virtuosoRef}
      className="h-full virtuoso-scroller"
      data={rows}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={Math.max(0, rows.length - 1)}
      increaseViewportBy={OVERSCAN}
      // Let Virtuoso probe a real message height. A hard-coded 56px estimate is
      // badly wrong for media and preview cards and causes large corrections.
      // Fires when the user scrolls to the very top -> load older messages.
      startReached={() => {
        if (hasMore && !isLoading) onLoadMore?.()
      }}
      atBottomStateChange={atBottom => onAtBottomChange?.(atBottom)}
      followOutput={atBottom => (atBottom ? "auto" : false)}
      computeItemKey={(_i, r) =>
        isSep(r) ? r.key : ((r as store.DecodedMessage).Info?.ID ?? String(_i))
      }
      context={{ isLoading }}
      components={listComponents}
      itemContent={(idx, row) => {
        if (isSep(row)) return <DateSeparator label={row.label} />

        const msg = row as store.DecodedMessage
        // Find the previous *message* skipping separators.
        let prev: store.DecodedMessage | undefined
        for (let p = idx - 1; p >= 0; p--) {
          const c = rows[p]
          if (!isSep(c)) {
            prev = c as store.DecodedMessage
            break
          }
        }
        const firstInGroup =
          !prev ||
          prev.Info?.IsFromMe !== msg.Info?.IsFromMe ||
          prev.Info?.Sender !== msg.Info?.Sender

        return (
          <div data-message-id={msg.Info?.ID} className={firstInGroup ? "pt-2 pb-px" : "py-px"}>
            <MemoizedMessageItem
              message={msg}
              chatId={chatId}
              firstInGroup={firstInGroup}
              pinnedIds={pinnedIds}
              sentMediaCache={sentMediaCache}
              onReply={onReply}
              onEdit={onEdit}
              onQuotedClick={onQuotedClick}
              highlightedMessageId={highlightedMessageId}
            />
          </div>
        )
      }}
    />
  )
})
