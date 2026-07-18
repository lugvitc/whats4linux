import React, { useState, useEffect, useMemo, lazy, Suspense } from "react"
import { store } from "../../../wailsjs/go/models"
import {
  DownloadImageToFile,
  GetCachedAvatar,
  SendReaction,
  SetMessagePinned,
} from "../../../wailsjs/go/api/Api"
import { MediaContent } from "./MediaContent"
import { QuotedMessage } from "./QuotedMessage"
import { ReactionBubble } from "./Reactions"
import { LinkPreview } from "./LinkPreview"
import clsx from "clsx"
import { MessageMenu } from "./MessageMenu"
import {
  ClockPendingIcon,
  BlueTickIcon,
  ForwardedIcon,
  UserAvatar,
} from "../../assets/svgs/chat_icons"
import { useContactStore } from "../../store/useContactStore"
import { useMessageStore } from "../../store"
import { isMe } from "../../lib/self"
import { formatPhone, phoneFromJID } from "../../lib/utils"
import { LRUCache } from "../../lib/lruCache"

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"]
const EmojiPicker = lazy(() => import("./EmojiPickerLazy"))

interface MessageItemProps {
  message: store.DecodedMessage
  chatId: string
  firstInGroup?: boolean
  pinnedIds?: Set<string>
  sentMediaCache: React.MutableRefObject<Map<string, string>>
  onReply?: (message: store.DecodedMessage) => void
  onQuotedClick?: (messageId: string) => void
  highlightedMessageId?: string | null
}

// Module-level cache: one avatar lookup per sender per session, shared by
// every message row (Virtuoso mounts/unmounts rows constantly).
const senderAvatarCache = new LRUCache<string, string | null>(128, 16 * 1024 * 1024, value =>
  value ? value.length : 1,
)

function SenderAvatar({ jid }: { jid: string }) {
  const [url, setUrl] = useState<string | null>(senderAvatarCache.get(jid) ?? null)

  useEffect(() => {
    if (!jid || senderAvatarCache.has(jid)) return
    let live = true
    GetCachedAvatar(jid, false)
      .then(u => {
        senderAvatarCache.set(jid, u || null)
        if (live) setUrl(u || null)
      })
      .catch(() => senderAvatarCache.set(jid, null))
    return () => {
      live = false
    }
  }, [jid])

  return (
    <div className="w-7 h-7 ml-3 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 shrink-0 self-start flex items-center justify-center text-gray-500 dark:text-gray-400 [&_svg]:w-5 [&_svg]:h-5">
      {url ? <img src={url} className="w-full h-full object-cover" /> : <UserAvatar />}
    </div>
  )
}

// Detect emoji-only messages so they render large without a visible change
// in bubble chrome, like WhatsApp.
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\u{FE0F}\u{200D}\s]+$/u

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

export function MessageItem({
  message,
  chatId,
  firstInGroup = true,
  pinnedIds,
  sentMediaCache,
  onReply,
  onQuotedClick,
  highlightedMessageId,
}: MessageItemProps) {
  const isFromMe = message.Info.IsFromMe
  const content = message.Content
  const isSticker = !!content?.stickerMessage
  const isPending = (message as any).isPending || false
  const isGroup = chatId.endsWith("@g.us")
  // Empty for @lid senders — those JIDs carry no phone number.
  const senderPhone = formatPhone(phoneFromJID(message.Info.Sender))
  // Seed sender name/color from the cache synchronously so a cached group
  // message renders correctly on first paint and never re-renders for it.
  const cachedSender =
    !isFromMe && isGroup && message.Info.Sender
      ? useContactStore.getState().contacts[message.Info.Sender]
      : undefined
  const [senderName, setSenderName] = useState(
    cachedSender?.name || "~ " + message.Info.PushName || "Unknown",
  )
  const [senderColor, setSenderColor] = useState<string | undefined>(cachedSender?.senderColor)
  const getSenderInfo = useContactStore(state => state.getSenderInfo)
  const addReactionToMessage = useMessageStore(state => state.addReactionToMessage)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [showFullEmoji, setShowFullEmoji] = useState(false)
  // Derived directly from the message; no state/effect needed (a state+effect
  // here forced an extra re-render per message on mount).
  const reactions = message.reactions ?? []

  // Helper function to render caption with markdown
  const renderCaption = (caption: string | undefined) => {
    if (!caption) return null
    return <div className="mt-1" dangerouslySetInnerHTML={{ __html: caption }} />
  }

  const handleImageDownload = async () => {
    try {
      await DownloadImageToFile(message.Info.ID)
    } catch (e) {}
  }

  const handleReply = () => onReply?.(message)

  const handleCopy = () => {
    const textToCopy = content?.conversation || content?.extendedTextMessage?.text || ""
    if (textToCopy) {
      const div = document.createElement("div")
      div.innerHTML = textToCopy
      navigator.clipboard.writeText(div.innerText)
    }
  }

  const handleReact = () => setShowReactionPicker(v => !v)

  const myReaction = (reactions as any[]).find(r => isMe(r.sender_id))?.emoji as string | undefined

  const sendReaction = (emoji: string) => {
    // Tapping the emoji you already reacted with removes it (WhatsApp behaviour).
    const finalEmoji = myReaction === emoji ? "" : emoji
    // For our own messages the reaction key's sender is us (empty -> backend
    // fills in own JID); for received messages it's the original sender.
    const senderJID = isFromMe ? "" : message.Info.Sender
    SendReaction(chatId, senderJID, message.Info.ID, finalEmoji).catch(() => {})
    addReactionToMessage(chatId, message.Info.ID, finalEmoji, "me")
    setShowReactionPicker(false)
    setShowFullEmoji(false)
  }

  const isPinned = pinnedIds?.has(message.Info.ID) ?? false

  const handlePin = () => {
    SetMessagePinned(chatId, message.Info.Sender, message.Info.ID, isFromMe, !isPinned).catch(err =>
      console.error("Failed to toggle message pin:", err),
    )
  }

  // Fetch group member name + color from the cached store (one RPC per sender,
  // then synchronous) so scrolling a group chat doesn't fire an RPC per row.
  useEffect(() => {
    if (isFromMe || !isGroup || !message.Info.Sender) return
    // Already seeded from cache above — no fetch, no re-render.
    if (useContactStore.getState().contacts[message.Info.Sender]) return
    let cancelled = false
    getSenderInfo(message.Info.Sender)
      .then(({ name, color }) => {
        if (cancelled) return
        if (name) setSenderName(name)
        if (color) setSenderColor(color)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [message.Info.Sender, isGroup, isFromMe, getSenderInfo])

  const contextInfo =
    content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo ||
    content?.audioMessage?.contextInfo ||
    content?.documentMessage?.contextInfo ||
    content?.stickerMessage?.contextInfo

  const isTextContent = !!(content?.conversation || content?.extendedTextMessage?.text)

  // Intl formatting is relatively expensive — compute once per timestamp.
  const timeStr = useMemo(
    () =>
      new Date(message.Info.Timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    [message.Info.Timestamp],
  )

  // Inline metadata (time + ticks). For text messages it floats into the last
  // line WhatsApp-style; for media/documents it renders as a bottom row.
  const timeMeta = (floated: boolean) => (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-[11px] leading-none opacity-60 select-none whitespace-nowrap",
        floated && "float-right ml-2 mt-2",
      )}
    >
      {message.edited && <span>Edited</span>}
      <span>{timeStr}</span>
      {isFromMe && (isPending ? <ClockPendingIcon /> : <BlueTickIcon />)}
    </span>
  )

  const renderContent = () => {
    if (!content) return <span className="italic opacity-50">Empty Message</span>
    else if (content.conversation || content.extendedTextMessage?.text) {
      const htmlContent = content.conversation || content.extendedTextMessage?.text || ""
      const stripped = htmlContent
        .replace(/<[^>]*>/g, "")
        .replace(/&\w+;/g, "")
        .trim()
      const emojiOnly = stripped.length > 0 && stripped.length <= 16 && EMOJI_ONLY_RE.test(stripped)
      return (
        <>
          <div className={clsx("[display:flow-root]", emojiOnly && "text-[32px] leading-10")}>
            <span dangerouslySetInnerHTML={{ __html: htmlContent }} />
            {timeMeta(true)}
          </div>
          {htmlContent.includes('class="msg-link"') && (
            <LinkPreview messageId={message.Info.ID} preview={message.link_preview ?? null} />
          )}
        </>
      )
    } else if (content.imageMessage)
      return (
        <div className="flex flex-col">
          <MediaContent
            message={message}
            type="image"
            chatId={chatId}
            sentMediaCache={sentMediaCache}
            onDownload={handleImageDownload}
          />
          {renderCaption(content.imageMessage.caption)}
        </div>
      )
    else if (content.videoMessage)
      return (
        <div className="flex flex-col">
          <MediaContent
            message={message}
            type="video"
            chatId={chatId}
            isGif={!!content.videoMessage.gifPlayback}
            sentMediaCache={sentMediaCache}
          />
          {renderCaption(content.videoMessage.caption)}
        </div>
      )
    else if (content.audioMessage)
      return (
        <MediaContent
          message={message}
          type="audio"
          chatId={chatId}
          sentMediaCache={sentMediaCache}
        />
      )
    else if (content.stickerMessage)
      return <MediaContent message={message} type="sticker" chatId={chatId} />
    else if (content.documentMessage) {
      const doc = content.documentMessage
      const fileName = doc.fileName || "Document"
      const extension = fileName.split(".").pop()?.toUpperCase() || "FILE"
      // fileLength is not available in DecodedMessageContent, show "Unknown size"
      const fileSize = 0

      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-3 bg-black/5 dark:bg-white/5 p-2 rounded-lg min-w-60">
            <div className="w-10 h-12 bg-red-500 rounded flex items-center justify-center text-white font-bold text-[10px] relative">
              <div className="absolute top-0 right-0 border-t-10 border-r-10 border-t-white/20 border-r-transparent"></div>
              {extension.slice(0, 4)}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="truncate font-medium text-sm text-gray-900 dark:text-gray-100">
                {fileName}
              </div>
              <div className="text-xs opacity-60 text-gray-500 dark:text-gray-400">
                {fileSize > 0 ? formatSize(fileSize) : "Document"}
              </div>
            </div>
            <button
              onClick={handleImageDownload}
              className="p-2 border border-gray-300 dark:border-gray-600 rounded-full"
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                className="fill-current text-gray-600 dark:text-gray-300"
              >
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
              </svg>
            </button>
          </div>
          {renderCaption(doc.caption)}
        </div>
      )
    }
    // Note: senderKeyDistributionMessage and reactionMessage are not stored in messages.db
    // Reactions are stored separately and shown via the Reactions field
    return <span className="italic opacity-50 text-xs">Unsupported Message Type</span>
  }

  const hasMedia = !!(content?.imageMessage || content?.videoMessage)

  return (
    <>
      <div
        className={clsx(
          "flex group",
          isFromMe ? "justify-end" : "justify-start",
          // Reserve room for the reaction pill overhanging the bubble bottom.
          reactions.length > 0 && "mb-3",
          {
            // Transition scoped to the highlighted row only — a blanket
            // transition on every row makes scrolling more expensive.
            "bg-[#21C063]/50 dark:bg-[#21C063]/40 transition-colors duration-200":
              highlightedMessageId === message.Info.ID,
          },
        )}
      >
        {/* Sender avatar column (group chats, received): avatar on the first
            message of a run, an equally wide spacer on the rest. */}
        {!isFromMe &&
          isGroup &&
          (firstInGroup ? (
            <SenderAvatar jid={message.Info.Sender} />
          ) : (
            <div className="w-7 ml-3 shrink-0" />
          ))}
        <div
          className={clsx(
            "max-w-[85%] lg:max-w-[65%] rounded-xl px-2 pt-1 pb-1.5 relative min-w-0",
            !isFromMe && isGroup ? "ml-2 mr-5" : "mx-5",
            {
              "w-min": hasMedia,
              "bg-transparent shadow-none": isSticker,
              // WhatsApp sharpens the corner facing the sender on the first
              // bubble of a run.
              "rounded-tl-[4px]": firstInGroup && !isFromMe && !isSticker,
              "rounded-tr-[4px]": firstInGroup && isFromMe && !isSticker,

              // SENT
              "bg-sent-bubble-bg dark:bg-sent-bubble-dark-bg text-(--color-sent-bubble-text) dark:text-(--color-sent-bubble-dark-text)":
                isFromMe && !isSticker,

              // RECEIVED
              "bg-received-bubble-bg dark:bg-received-bubble-dark-bg text-(--color-received-bubble-text) dark:text-(--color-received-bubble-dark-text)":
                !isFromMe && !isSticker,
            },
          )}
        >
          {/* Hover reaction trigger just outside the bubble (WhatsApp-style). */}
          <button
            onClick={() => setShowReactionPicker(v => !v)}
            title="React"
            className={clsx(
              "absolute bottom-1 z-20 rounded-full bg-white p-1 text-sm leading-none opacity-0 shadow transition-opacity group-hover:opacity-100 dark:bg-dark-tertiary",
              isFromMe ? "-left-9" : "-right-9",
            )}
          >
            🙂
          </button>

          {showReactionPicker && (
            <div
              className={clsx(
                "absolute bottom-9 z-9999 flex w-max items-center gap-1 rounded-full bg-white px-2 py-1 shadow-lg dark:bg-dark-tertiary",
                isFromMe ? "right-0" : "left-0",
              )}
            >
              {QUICK_REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className={clsx(
                    "rounded-full px-1 text-lg leading-none transition-transform hover:scale-125",
                    myReaction === emoji && "bg-blue-500/40",
                  )}
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => {
                  setShowFullEmoji(true)
                  setShowReactionPicker(false)
                }}
                title="More"
                className="ml-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/10 text-sm dark:bg-white/10"
              >
                +
              </button>
            </div>
          )}

          {showFullEmoji && (
            <div className="absolute bottom-9 z-9999" style={isFromMe ? { right: 0 } : { left: 0 }}>
              <Suspense
                fallback={
                  <div className="rounded bg-white p-2 text-xs shadow dark:bg-dark-tertiary">
                    Loading…
                  </div>
                }
              >
                <EmojiPicker
                  onEmojiSelect={(e: any) => sendReaction(e.native)}
                  onClickOutside={() => setShowFullEmoji(false)}
                  theme="auto"
                  previewPosition="none"
                  skinTonePosition="none"
                />
              </Suspense>
            </div>
          )}
          {/* Message Menu - positioned at top right corner */}
          <MessageMenu
            messageId={message.Info.ID}
            isFromMe={isFromMe}
            isPinned={isPinned}
            onPin={handlePin}
            onReply={handleReply}
            onCopy={handleCopy}
            onReact={handleReact}
          />

          {!isFromMe && chatId.endsWith("@g.us") && firstInGroup && (
            <div className="flex items-baseline justify-between gap-4 mb-0.5 pt-0.5">
              <span className="text-[11px] font-semibold truncate" style={{ color: senderColor }}>
                {senderName}
              </span>
              {/* WhatsApp shows the phone number next to the name for senders
                  that aren't saved contacts (pushName-only, "~"-prefixed). */}
              {senderName.startsWith("~") && senderPhone && (
                <span className="shrink-0 text-[11px] text-black/40 dark:text-white/40">
                  {senderPhone}
                </span>
              )}
            </div>
          )}
          {message.forwarded && (
            <div className="text-[10px] flex gap-1 italic items-center opacity-60 mb-1">
              <ForwardedIcon />
              Forwarded
            </div>
          )}
          {contextInfo?.quotedMessage && (
            <QuotedMessage contextInfo={contextInfo} onQuotedClick={onQuotedClick} />
          )}
          <div className="text-sm break-words whitespace-pre-wrap">{renderContent()}</div>
          {!isTextContent && <div className="mt-1 flex justify-end">{timeMeta(false)}</div>}

          {/* Reactions */}
          {reactions.length > 0 && (
            <div
              onClick={() => setShowReactionPicker(v => !v)}
              className={clsx(
                "absolute -bottom-3 z-9999 cursor-pointer",
                isFromMe ? "right-2" : "left-2",
              )}
            >
              <ReactionBubble reactions={reactions} isFromMe={isFromMe} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export const MessagePreview = () => {
  return (
    <div className="flex flex-col gap-3 w-65">
      <div className="flex justify-start">
        <div
          className="max-w-[80%] px-3 py-2 rounded-lg text-sm shadow-sm
            bg-received-bubble-bg dark:bg-received-bubble-dark-bg 
            text-received-bubble-text dark:text-received-bubble-dark-text"
        >
          hey 👋
        </div>
      </div>
      <div className="flex justify-end">
        <div
          className="max-w-[80%] px-3 py-2 rounded-lg text-sm shadow-sm
            bg-sent-bubble-bg dark:bg-sent-bubble-dark-bg 
            text-sent-bubble-text dark:text-sent-bubble-dark-text"
        >
          what's up 😎
        </div>
      </div>
    </div>
  )
}
