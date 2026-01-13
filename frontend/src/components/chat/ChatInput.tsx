import React, { lazy, Suspense, useState, useRef, useEffect } from "react"
import clsx from "clsx"
import data from "@emoji-mart/data"
import {
  EmojiIcon,
  AttachIcon,
  SendIcon,
  CloseIcon,
  UserAvatar,
} from "../../assets/svgs/chat_icons"
import { store } from "../../../wailsjs/go/models"
import { GetCachedAvatar } from "../../../wailsjs/go/api/Api"
import { useContactStore } from "../../store/useContactStore"

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
  mentionableContacts: any[]
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onSendMessage: () => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveFile: () => void
  onEmojiClick: (emoji: string) => void
  onToggleEmojiPicker: () => void
  onCancelReply: () => void
  onMentionAdd: (contact: any) => void
  selectedMentions: any[]
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
  mentionableContacts,
  onInputChange,
  onKeyDown,
  onPaste,
  onSendMessage,
  onFileSelect,
  onRemoveFile,
  onEmojiClick,
  onToggleEmojiPicker,
  onCancelReply,
  onMentionAdd,
  selectedMentions,
}: ChatInputProps) {
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [mentionAvatars, setMentionAvatars] = useState<Record<string, string>>({})
  const [loadingAvatars, setLoadingAvatars] = useState<Record<string, boolean>>({})
  const avatarCacheRef = useRef<Record<string, string>>({})
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  const renderHighlightedText = () => {
    if (!inputText) return null
    if (selectedMentions.length === 0) return inputText

    const mentionNames = selectedMentions.map(m => {
      let name = m.full_name
      if (!name) {
        if (m.push_name) name = `~ ${m.push_name}`
        else name = m.short || m.jid
      }
      return "@" + name
    })
    if (mentionNames.length === 0) return inputText

    const pattern = new RegExp(`(${mentionNames.join("|")})`, "g")
    const parts = inputText.split(pattern)

    return parts.map((part, index) => {
      if (mentionNames.includes(part)) {
        return (
          <span key={index} className="text-green-500">
            {part}
          </span>
        )
      }
      return <span key={index}>{part}</span>
    })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    onInputChange(e)

    // Check for mention trigger
    const mentionMatch = value.match(/@(\w*)$/)
    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase()
      const matches = mentionableContacts
        .map((contact: any) => ({
          contact,
          name: (
            (contact.full_name && contact.full_name) ||
            (contact.push_name && contact.push_name) ||
            contact.short ||
            contact.jid ||
            ""
          ).toLowerCase(),
        }))
        .filter((c: any) => c.name.includes(query))
        .slice(0, 5)

      setMentionSuggestions(matches.map((m: any) => m.contact))
      setShowSuggestions(matches.length > 0)
    } else {
      setShowSuggestions(false)
    }
  }

  const handleSuggestionClick = (contact: any) => {
    let name = contact.full_name
    if (!name) {
      if (contact.push_name) {
        name = `~ ${contact.push_name}`
      } else {
        name = contact.short || contact.jid
      }
    }
    const newText = inputText.replace(/@\w*$/, `@${name} `)
    const fakeEvent = {
      target: { value: newText },
    } as React.ChangeEvent<HTMLTextAreaElement>
    onInputChange(fakeEvent)
    setShowSuggestions(false)
    onMentionAdd(contact)
  }

  const hasContent = inputText.trim() || pastedImage || selectedFile
  const [senderName, setSenderName] = useState<string>("")
  const [senderColor, setSenderColor] = useState<string>("")
  const [loadingSenderName, setLoadingSenderName] = useState<boolean>(false)
  const getContactName = useContactStore(state => state.getContactName)
  const getContactColor = useContactStore(state => state.getContactColor)

  useEffect(() => {
    if (!replyingTo || replyingTo.Info.IsFromMe) {
      setSenderName("")
      setSenderColor("")
      setLoadingSenderName(false)
      return
    }

    const participant = replyingTo.Info.Sender
    if (participant) {
      let mounted = true
      setLoadingSenderName(true)
      getContactName(participant)
        .then((contactName: string) => {
          if (!mounted) return
          if (contactName) setSenderName(contactName)
        })
        .catch(() => {})
        .finally(() => {
          if (!mounted) return
          setLoadingSenderName(false)
        })
      getContactColor(participant)
        .then((color: string) => {
          if (!mounted) return
          if (color) setSenderColor(color)
        })
        .catch(() => {})

      return () => {
        mounted = false
      }
    }
  }, [replyingTo, getContactName, getContactColor])

  useEffect(() => {
    const loadAvatars = async () => {
      const contactsToLoad = mentionSuggestions.filter(
        contact => !(contact.jid in avatarCacheRef.current),
      )

      if (contactsToLoad.length === 0) {
        const cached: Record<string, string> = {}
        for (const contact of mentionSuggestions) {
          cached[contact.jid] = avatarCacheRef.current[contact.jid] || ""
        }
        setMentionAvatars(cached)
        return
      }

      setLoadingAvatars(prev => {
        const next = { ...prev }
        for (const contact of contactsToLoad) {
          next[contact.jid] = true
        }
        return next
      })

      // Load avatars for contacts not in cache
      for (const contact of contactsToLoad) {
        try {
          const userJid = contact.raw_jid
          const avatar = await GetCachedAvatar(userJid, false)
          avatarCacheRef.current[contact.jid] = avatar || ""
        } catch (err) {
          console.error("Failed to load avatar for", contact.jid, err)
          avatarCacheRef.current[contact.jid] = ""
        }
      }

      // Clear loading state
      setLoadingAvatars(prev => {
        const next = { ...prev }
        for (const contact of contactsToLoad) {
          next[contact.jid] = false
        }
        return next
      })

      // Update avatars state from cache
      const updated: Record<string, string> = {}
      for (const contact of mentionSuggestions) {
        updated[contact.jid] = avatarCacheRef.current[contact.jid] || ""
      }
      setMentionAvatars(updated)
    }

    if (mentionSuggestions.length > 0) {
      loadAvatars()
    } else {
      setMentionAvatars({})
    }
  }, [mentionSuggestions])

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

    const senderLabel = replyingTo.Info.IsFromMe
      ? "You"
      : senderName || replyingTo.Info.PushName || "Contact"

    return (
      <div className="mb-2 flex items-start gap-2 rounded-md bg-black/5 dark:bg-white/10 p-2 text-xs">
        <div className="flex-1 min-w-0">
          <div
            className="font-semibold flex items-center gap-2"
            style={{ color: replyingTo.Info.IsFromMe ? undefined : senderColor }}
          >
            {loadingSenderName && (
              <span className="w-3 h-3 rounded-full border-2 border-green-600 border-t-transparent animate-spin" />
            )}
            {senderLabel}
          </div>
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
        "relative p-2 mb-4 mx-5 border dark:border-dark-secondary bg-light-bg dark:bg-dark-tertiary",
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
        <div className="flex-1 bg-light-bg dark:bg-dark-tertiary rounded-full relative">
          <div
            ref={backdropRef}
            className={clsx(
              "absolute inset-0 w-full p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words pointer-events-none",
              "text-gray-900 dark:text-white",
            )}
            style={{ fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit" }}
            aria-hidden="true"
          >
            {renderHighlightedText()}
          </div>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onScroll={handleScroll}
            placeholder="Type a message"
            className={clsx(
              "relative z-10 w-full p-2 bg-transparent resize-none outline-none max-h-32",
              "text-transparent caret-green",
              "placeholder:text-gray-500",
            )}
            rows={1}
          />
          {/* Mention Suggestions */}
          {showSuggestions && (
            <div
              ref={suggestionsRef}
              className="absolute bottom-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto"
            >
              {mentionSuggestions.map(contact => {
                const avatar = mentionAvatars[contact.jid]
                const isLoading = loadingAvatars[contact.jid]
                return (
                  <div
                    key={contact.jid}
                    onClick={() => handleSuggestionClick(contact)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
                  >
                    <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden flex items-center justify-center shrink-0">
                      {isLoading ? (
                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      ) : avatar ? (
                        <img
                          src={avatar}
                          alt={contact.full_name || contact.push_name || contact.short}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <UserAvatar />
                      )}
                    </div>
                    <span>
                      {contact.full_name || contact.push_name || contact.short || contact.jid}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
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
