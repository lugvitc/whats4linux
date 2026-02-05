import React, { useState, useEffect, useRef } from "react"
import { store } from "../../../wailsjs/go/models"
import { DownloadImageToFile, GetContact } from "../../../wailsjs/go/api/Api"
import { MediaContent } from "./MediaContent"
import { QuotedMessage } from "./QuotedMessage"
import clsx from "clsx"
import { MessageMenu } from "./MessageMenu"
import { ClockPendingIcon, BlueTickIcon, ForwardedIcon } from "../../assets/svgs/chat_icons"

interface MessageItemProps {
  message: store.DecodedMessage
  chatId: string
  sentMediaCache: React.MutableRefObject<Map<string, string>>
  onReply?: (message: store.DecodedMessage) => void
  onQuotedClick?: (messageId: string) => void
  highlightedMessageId?: string | null
}

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
  sentMediaCache,
  onReply,
  onQuotedClick,
  highlightedMessageId
}: MessageItemProps) {
  // console.log(message)
  const isFromMe = message.Info.IsFromMe
  // Debug: log every render and also when the message updates or unmounts
  // console.log(`[MessageItem] render id=${message.Info.ID} fromMe=${isFromMe} chat=${chatId}`)
  useEffect(() => {
    // console.log(`[MessageItem] message updated id=${message.Info.ID}`, message)
    return () => {
      // console.log(`[MessageItem] cleanup/unmount id=${message.Info.ID}`)
    }
  }, [message.Info.ID, message.Info.Timestamp])
  const content = message.Content
  const isSticker = !!content?.stickerMessage
  const isPending = (message as any).isPending || false
  const [senderName, setSenderName] = useState("~ " + message.Info.PushName || "Unknown")
  const innerDiv = useRef<HTMLDivElement | null>(null)

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

  const handleReplyPrivately = () => {
    // TODO: Implement reply privately functionality
  }

  const handleMessage = () => {
    // TODO: Implement message functionality
  }

  const handleCopy = () => {
    const textToCopy = content?.conversation || content?.extendedTextMessage?.text || ""
    if (textToCopy) {
      const div = document.createElement("div")
      div.innerHTML = textToCopy
      navigator.clipboard.writeText(div.innerText)
    }
  }

  const handleReact = () => {
    // TODO: Implement react functionality
  }

  const handleForward = () => {
    // TODO: Implement forward functionality
  }

  const handleStar = () => {
    // TODO: Implement star functionality
  }

  const handleReport = () => {
    // TODO: Implement report functionality
  }

  const handleDelete = () => {
    // TODO: Implement delete functionality
  }

  // Fetch Group Member Names (Feature #2)
  useEffect(() => {
    if (!isFromMe && message.Info.Sender && chatId.endsWith("@g.us")) {
      // GetContact now accepts a string JID directly
      GetContact(message.Info.Sender)
        .then((contact: any) => {
          if (contact?.full_name || contact?.push_name) {
            setSenderName(contact.full_name || "~ " + contact.push_name)
          }
        })
        .catch(() => {})
    }
  }, [message.Info.Sender, chatId, isFromMe])

  const contextInfo =
    content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo ||
    content?.audioMessage?.contextInfo ||
    content?.documentMessage?.contextInfo ||
    content?.stickerMessage?.contextInfo

  const renderContent = () => {
    if (!content) return <span className="italic opacity-50">Empty Message</span>
    else if (content.conversation || content.extendedTextMessage?.text) {
      const htmlContent = content.conversation || content.extendedTextMessage?.text
      return <div className="pr-5" dangerouslySetInnerHTML={{ __html: htmlContent }} />
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
    console.log("Unsupported message content:", content)
    return <span className="italic opacity-50 text-xs">Unsupported Message Type</span>
  }

  const hasMedia = !!(content?.imageMessage || content?.videoMessage)

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (innerDiv.current){
      const react = innerDiv.current.getBoundingClientRect()
      if (!isFromMe && event.clientX > react.right){
        handleReply()
      }
      else if (isFromMe && event.clientX < react.left){
        handleReply()
      }
    }
    // event.stopPropagation()
  }

  return (
    <div className="flex flex-col" onDoubleClick={handleDoubleClick}>
      <div
        className={clsx(
          "flex mb-2 group transition duration-200",
          isFromMe ? "justify-end" : "justify-start",
          {
            "bg-[#21C063]/50 dark:bg-[#21C063]/40": highlightedMessageId === message.Info.ID,
          },
        )}
      >
        <div ref={innerDiv}
          className={clsx(
            "max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg xl:max-w-xl rounded-lg p-2 mx-5 shadow-sm relative min-w-0",
            {
              "w-min": hasMedia,
              "bg-transparent shadow-none": isSticker,

              // SENT
              "bg-sent-bubble-bg dark:bg-sent-bubble-dark-bg text-(--color-sent-bubble-text) dark:text-(--color-sent-bubble-dark-text)":
                isFromMe && !isSticker,

              // RECEIVED
              "bg-received-bubble-bg dark:bg-received-bubble-dark-bg text-(--color-received-bubble-text) dark:text-(--color-received-bubble-dark-text)":
                !isFromMe && !isSticker,
            },
          )
        }
          // onDoubleClick={handleDoubleClick}
        >
          {/* Message Menu - positioned at top right corner */}
          <MessageMenu
            messageId={message.Info.ID}
            isFromMe={isFromMe}
            onReply={handleReply}
            onReplyPrivately={!isFromMe ? handleReplyPrivately : undefined}
            onMessage={!isFromMe ? handleMessage : undefined}
            onCopy={handleCopy}
            onReact={handleReact}
            onForward={handleForward}
            onStar={handleStar}
            onReport={!isFromMe ? handleReport : undefined}
            onDelete={handleDelete}
          />

          {!isFromMe && chatId.endsWith("@g.us") && (
            <div className="text-[11px] font-semibold text-blue-500 mb-0.5">{senderName}</div>
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
          <div className="text-sm wrap-break-words whitespace-pre-wrap">{renderContent()}</div>
          <div className="text-[10px] text-right opacity-50 mt-1 flex items-center justify-end gap-1">
            {message.edited && <span className="text-[9px] opacity-60">edited</span>}
            <span>
              {new Date(message.Info.Timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {isFromMe && (isPending ? <ClockPendingIcon /> : <BlueTickIcon />)}
          </div>
        </div>
      </div>
    </div>
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
