import React, { useState, useEffect } from "react"
import { store } from "../../../wailsjs/go/models"
import { DownloadMedia, GetContact } from "../../../wailsjs/go/api/Api"
import { parseWhatsAppMarkdown } from "../../utils/markdown"
import { MediaContent } from "./MediaContent"
import { QuotedMessage } from "./QuotedMessage"
import { MessageMenu } from "./MessageMenu"

interface MessageItemProps {
  message: store.Message
  chatId: string
  sentMediaCache: React.MutableRefObject<Map<string, string>>
}

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

export function MessageItem({ message, chatId, sentMediaCache }: MessageItemProps) {
  const isFromMe = message.Info.IsFromMe
  const content = message.Content
  const isSticker = !!content?.stickerMessage
  const [senderName, setSenderName] = useState(message.Info.PushName || "Unknown")

  const handleReply = () => {
    // TODO: Implement reply functionality
  }

  const handleReplyPrivately = () => {
    // TODO: Implement reply privately functionality
  }

  const handleMessage = () => {
    // TODO: Implement message functionality
  }

  const handleCopy = () => {
    const textToCopy = content?.conversation || content?.extendedTextMessage?.text || ""
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy)
      console.log("Copied to clipboard")
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
      GetContact(message.Info.Sender)
        .then((contact: any) => {
          if (contact?.full_name || contact?.push_name) {
            setSenderName(contact.full_name || contact.push_name)
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
    else if (content.conversation) return parseWhatsAppMarkdown(content.conversation)
    else if (content.extendedTextMessage?.text)
      return parseWhatsAppMarkdown(content.extendedTextMessage.text)
    else if (content.imageMessage)
      return (
        <div className="flex flex-col">
          <MediaContent
            message={message}
            type="image"
            chatId={chatId}
            sentMediaCache={sentMediaCache}
          />
          {content.imageMessage.caption && (
            <div className="mt-1">{parseWhatsAppMarkdown(content.imageMessage.caption)}</div>
          )}
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
          {content.videoMessage.caption && (
            <div className="mt-1">{parseWhatsAppMarkdown(content.videoMessage.caption)}</div>
          )}
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
      const fileSize =
        typeof doc.fileLength === "number" ? doc.fileLength : (doc.fileLength as any)?.low || 0

      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-3 bg-black/5 dark:bg-white/5 p-2 rounded-lg min-w-[240px]">
            <div className="w-10 h-12 bg-red-500 rounded flex items-center justify-center text-white font-bold text-[10px] relative">
              <div className="absolute top-0 right-0 border-t-[10px] border-r-[10px] border-t-white/20 border-r-transparent"></div>
              {extension.slice(0, 4)}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="truncate font-medium text-sm text-gray-900 dark:text-gray-100">
                {fileName}
              </div>
              <div className="text-xs opacity-60 text-gray-500 dark:text-gray-400">
                {formatSize(fileSize)}
              </div>
            </div>
            <button
              onClick={() => DownloadMedia(chatId, message.Info.ID)}
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
          {doc.caption && <div className="mt-1">{parseWhatsAppMarkdown(doc.caption)}</div>}
        </div>
      )
    } else return <span className="italic opacity-50 text-xs">Unsupported Message Type</span>
  }

  return (
    <div className={`flex ${isFromMe ? "justify-end" : "justify-start"} mb-2 group`}>
      <div
        className={`max-w-[75%] rounded-lg p-2 shadow-sm relative ${
          isSticker
            ? "bg-transparent shadow-none"
            : isFromMe
              ? "bg-[#d9fdd3] dark:bg-[#005c4b] text-gray-900 dark:text-white"
              : "bg-white dark:bg-[#202c33] text-gray-900 dark:text-white"
        }`}
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

        {!isFromMe && chatId.endsWith("@g.us") && !isSticker && (
          <div className="text-[11px] font-semibold text-blue-500 mb-0.5">{senderName}</div>
        )}
        {contextInfo?.quotedMessage && <QuotedMessage contextInfo={contextInfo} />}
        <div className="text-sm wrap-break-word">{renderContent()}</div>
        <div className="text-[10px] text-right opacity-50 mt-1">
          {new Date(message.Info.Timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  )
}
