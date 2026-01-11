import React, { lazy, Suspense } from "react"
import clsx from "clsx"
import data from "@emoji-mart/data"
import { EmojiIcon, AttachIcon, SendIcon, CloseIcon } from "../../assets/svgs/chat_icons"
import { store } from "../../../wailsjs/go/models"

const EmojiPicker = lazy(() => import("@emoji-mart/react"))
interface ChatInputProps {
  inputText: string
  pastedImage: string | null
  selectedFile: File | null
  selectedFileType: string
  showEmojiPicker: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  emojiPickerRef: React.RefObject<HTMLDivElement | null>
  emojiButtonRef: React.RefObject<HTMLButtonElement | null>
  replyingTo: store.DecodedMessage | null
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onSendMessage: () => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveFile: () => void
  onEmojiClick: (emoji: string) => void
  onToggleEmojiPicker: () => void
  onCancelReply: () => void
}

const FILE_TYPE_ICONS = {
  image: "📷",
  video: "🎥",
  audio: "🎵",
  document: "📄",
} as const

interface IconButtonProps {
  onClick: () => void
  title: string
  children: React.ReactNode
  ref?: React.RefObject<HTMLButtonElement>
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ onClick, title, children }, ref) => (
    <button
      ref={ref}
      onClick={onClick}
      className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
      title={title}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = "IconButton"

interface FilePreviewProps {
  file: File
  fileType: string
  onRemove: () => void
}

const FilePreview = ({ file, fileType, onRemove }: FilePreviewProps) => (
  <div className="mb-2 flex items-center rounded-xl gap-2 bg-gray-100 dark:bg-gray-700 p-2 rounded-lg">
    <div className="flex-1">
      <div className="flex items-center gap-2">
        {FILE_TYPE_ICONS[fileType as keyof typeof FILE_TYPE_ICONS]}
        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{file.name}</span>
      </div>
      <span className="text-xs text-gray-500">{(file.size / 1024).toFixed(2)} KB</span>
    </div>
    <button onClick={onRemove} className="text-red-500 hover:text-red-600 p-1" title="Remove file">
      ×
    </button>
  </div>
)

interface ImagePreviewProps {
  imageSrc: string
  onRemove: () => void
}

const ImagePreview = ({ imageSrc, onRemove }: ImagePreviewProps) => (
  <div className="mb-2 relative inline-block">
    <img src={imageSrc} alt="Pasted" className="max-h-40 rounded-lg" />
    <button
      onClick={onRemove}
      className={clsx(
        "absolute top-1 right-1",
        "bg-red-500 text-white rounded-full",
        "w-6 h-6 flex items-center justify-center",
        "hover:bg-red-600 transition-colors",
      )}
    >
      ×
    </button>
  </div>
)

export function ChatInput({
  inputText,
  pastedImage,
  selectedFile,
  selectedFileType,
  showEmojiPicker,
  textareaRef,
  fileInputRef,
  emojiPickerRef,
  emojiButtonRef,
  replyingTo,
  onInputChange,
  onKeyDown,
  onPaste,
  onSendMessage,
  onFileSelect,
  onRemoveFile,
  onEmojiClick,
  onToggleEmojiPicker,
  onCancelReply,
}: ChatInputProps) {
  const hasContent = inputText.trim() || pastedImage || selectedFile

  const handleEmojiSelect = (emoji: any) => {
    onEmojiClick(emoji.native)
  }

  const renderReplyPreview = () => {
    if (!replyingTo) return null
    const content = replyingTo.Content
    const previewText =
      content?.conversation ||
      content?.extendedTextMessage?.text ||
      (content?.imageMessage ? "📷 Photo" : undefined) ||
      (content?.videoMessage ? "🎥 Video" : undefined) ||
      (content?.audioMessage ? "🎵 Audio" : undefined) ||
      (content?.documentMessage ? "📄 Document" : undefined) ||
      (content?.stickerMessage ? "Sticker" : undefined) ||
      "Message"

    const senderLabel = replyingTo.Info.IsFromMe ? "You" : replyingTo.Info.PushName || "Contact"

    return (
      <div className="mb-2 flex items-start gap-2 rounded-md bg-black/5 dark:bg-white/10 p-2 text-xs">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-green-600 dark:text-green-400">{senderLabel}</div>
          <div
            className="line-clamp-2 opacity-80"
            dangerouslySetInnerHTML={{ __html: previewText }}
          />
        </div>
        <button
          onClick={onCancelReply}
          className="ml-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
          title="Cancel reply"
        >
          <CloseIcon />
        </button>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        "relative p-2 mb-4 mx-5 border border-dark-secondary bg-light-bg dark:bg-dark-tertiary",
        replyingTo || pastedImage || selectedFile ? "rounded-t-xl rounded-b-3xl" : "rounded-full",
      )}
    >
      {showEmojiPicker && (
        <div ref={emojiPickerRef} className="absolute bottom-20 left-4 z-50">
          <Suspense fallback={<div className="p-4 text-sm">Loading emojis...</div>}>
            <EmojiPicker
              data={data}
              onEmojiSelect={handleEmojiSelect}
              theme="auto"
              previewPosition="none"
              skinTonePosition="search"
            />
          </Suspense>
        </div>
      )}

      {/* Image Preview (pasted) */}
      {pastedImage && <ImagePreview imageSrc={pastedImage} onRemove={onRemoveFile} />}

      {/* File Preview (attached) */}
      {selectedFile && (
        <FilePreview file={selectedFile} fileType={selectedFileType} onRemove={onRemoveFile} />
      )}
      {renderReplyPreview()}
      {/* Main Input Row */}
      <div className="flex items-center gap-2">
        {/* Emoji Button */}
        <IconButton ref={emojiButtonRef} onClick={onToggleEmojiPicker} title="Emoji">
          <EmojiIcon />
        </IconButton>

        {/* Attach Button */}
        <IconButton onClick={() => fileInputRef.current?.click()} title="Attach file">
          <AttachIcon />
        </IconButton>

        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileSelect}
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
        />

        {/* Text Input */}
        <div className="flex-1 bg-light-bg dark:bg-dark-tertiary rounded-full">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Type a message"
            className={clsx(
              "w-full p-2 bg-transparent resize-none outline-none max-h-32",
              "text-gray-900 dark:text-white caret-green",
              "placeholder:text-gray-500",
            )}
            rows={1}
          />
        </div>

        {/* Send Button */}
        <button
          onClick={onSendMessage}
          disabled={!hasContent}
          className={clsx(
            "p-2 rounded-full text-white transition-colors",
            hasContent ? "bg-green hover:bg-green/70" : "bg-green/50 cursor-not-allowed",
          )}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  )
}
