import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import {
  SendMessage,
  FetchMessagesPaged,
  GetPinnedMessages,
  SendChatPresence,
  GetGroupInfo,
  GetProfile,
  MarkRead,
} from "../../wailsjs/go/api/Api"
import { store } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { useMessageStore, useUIStore, useChatStore } from "../store"
import { MessageList, type MessageListHandle } from "../components/chat/MessageList"
import { ChatHeader } from "../components/chat/ChatHeader"
import { ChatInput } from "../components/chat/ChatInput"
import { ChatInfo } from "../components/chat/ChatInfo"
import clsx from "clsx"
import { formatPhone } from "../lib/utils"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { getEase } from "../store/useEaseStore"

interface ChatDetailProps {
  chatId: string
  chatName: string
  chatAvatar?: string
  onBack?: () => void
}

const PAGE_SIZE = 50
// Virtuoso needs a stable, large starting index so it can decrement as older
// messages are prepended, keeping the scroll position anchored.
const START_INDEX = 1_000_000

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function ChatDetail({ chatId, chatName, chatAvatar, onBack }: ChatDetailProps) {
  const {
    messages,
    setMessages,
    updateMessage,
    prependMessages,
    setActiveChatId,
    addPendingMessage,
    updatePendingMessageToSent,
  } = useMessageStore()
  const { setTypingIndicator, showEmojiPicker, setShowEmojiPicker, chatInfoOpen, setChatInfoOpen } =
    useUIStore()
  const { chatsById } = useChatStore()

  const chatMessages = messages[chatId] || []
  const [inputText, setInputText] = useState("")
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFileType, setSelectedFileType] = useState<string>("")
  const [replyingTo, setReplyingTo] = useState<store.DecodedMessage | null>(null)
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)

  const [mentionableContacts, setMentionableContacts] = useState<any[]>([])
  const [selectedMentions, setSelectedMentions] = useState<any[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX)

  // Reset the Virtuoso anchor synchronously when switching chats so the fresh
  // list (see key={chatId} on <MessageList>) starts from a clean base.
  const anchorChatIdRef = useRef(chatId)
  if (anchorChatIdRef.current !== chatId) {
    anchorChatIdRef.current = chatId
    setFirstItemIndex(START_INDEX)
  }

  const messageListRef = useRef<MessageListHandle>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const scrollButtonRef = useRef<HTMLButtonElement>(null)
  const sentMediaCache = useRef<Map<string, string>>(new Map())
  const isComposingRef = useRef(false)

  const easeShowRef = useRef(getEase("DropDown", "open"))
  const easeHideRef = useRef(getEase("DropDown", "close"))

  const currentChat = chatsById.get(chatId)
  const chatType = currentChat?.type || "contact"
  const [chatSubtitle, setChatSubtitle] = useState("")
  const [pinnedMessages, setPinnedMessages] = useState<store.PinnedMessage[]>([])
  // Which pinned message the banner jumps to next (cycles like WhatsApp).
  const pinnedCycleRef = useRef(0)

  const loadPinned = useCallback(async () => {
    try {
      const pins = await GetPinnedMessages(chatId)
      setPinnedMessages(pins || [])
    } catch (err) {
      console.error("Failed to load pinned messages:", err)
      setPinnedMessages([])
    }
  }, [chatId])

  useEffect(() => {
    pinnedCycleRef.current = 0
    loadPinned()
    const unsub = EventsOn("wa:pinned_update", (data: { chatId: string }) => {
      if (data?.chatId === chatId) loadPinned()
    })
    return unsub
  }, [chatId, loadPinned])

  const pinnedIds = useMemo(() => new Set(pinnedMessages.map(p => p.message_id)), [pinnedMessages])

  useEffect(() => {
    setChatSubtitle("")
    const loadMentionableContacts = async () => {
      if (chatType === "group") {
        try {
          const groupInfo = await GetGroupInfo(chatId)

          // WhatsApp-style participants line under the group name:
          // "You, Alice, ~ Bob, +91 98765 43210, …"
          const participantLabel = (c: any) =>
            c.full_name ||
            (c.push_name ? `~ ${c.push_name}` : "") ||
            c.short ||
            (c.phno ? formatPhone(c.phno) : "")
          try {
            const self = await GetProfile("")
            const others = groupInfo.group_participants
              .map((p: any) => p.contact)
              .filter((c: any) => c && c.phno !== self.phno && c.jid !== self.jid)
            setChatSubtitle(["You", ...others.map(participantLabel).filter(Boolean)].join(", "))
            setMentionableContacts(others)
          } catch (err) {
            const contacts = groupInfo.group_participants.map((p: any) => p.contact)
            setChatSubtitle(contacts.map(participantLabel).filter(Boolean).join(", "))
            setMentionableContacts(contacts)
          }
        } catch (error) {
          console.error("Failed to fetch group info:", error)
          setMentionableContacts([])
        }
      } else {
        setMentionableContacts([])
      }
    }
    loadMentionableContacts()
  }, [chatId, chatType])

  const scrollToBottom = useCallback((instant = false) => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToBottom(instant ? "auto" : "smooth")
    })
  }, [])

  const handleQuotedClick = useCallback((messageId: string) => {
    messageListRef.current?.scrollToMessage(messageId)
    setHighlightedMessageId(messageId)

    setTimeout(() => {
      setHighlightedMessageId(null)
    }, 500)
  }, [])

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom)
  }, [])

  // Focus the composer as soon as a chat is opened so the user can type
  // immediately (like WhatsApp).
  useEffect(() => {
    textareaRef.current?.focus()
  }, [chatId])

  // ESC: close overlays first (info panel, emoji picker, reply), then leave
  // the chat back to the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (chatInfoOpen) {
        setChatInfoOpen(false)
        return
      }
      if (showEmojiPicker) {
        setShowEmojiPicker(false)
        return
      }
      if (replyingTo) {
        setReplyingTo(null)
        return
      }
      if (onBack) {
        onBack()
      } else {
        useChatStore.getState().selectChat(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [chatInfoOpen, showEmojiPicker, replyingTo, onBack, setChatInfoOpen, setShowEmojiPicker])

  const loadInitialMessages = useCallback(async () => {
    setInitialLoad(true)
    setIsReady(false)
    try {
      const msgs = await FetchMessagesPaged(chatId, PAGE_SIZE, 0)
      const loadedMsgs = msgs || []

      setMessages(chatId, loadedMsgs)
      setHasMore(loadedMsgs.length >= PAGE_SIZE)

      requestAnimationFrame(() => {
        setIsReady(true)
        setInitialLoad(false)
        scrollToBottom(true)
      })
    } catch (err) {
      console.error("Initial load failed:", err)
      setInitialLoad(false)
    }
  }, [chatId, setMessages, scrollToBottom])

  const loadMoreMessages = useCallback(async () => {
    if (!hasMore || isLoadingMore) return

    const currentMessages = messages[chatId] || []
    if (currentMessages.length === 0) return

    setIsLoadingMore(true)
    const oldestMessage = currentMessages[0]
    const beforeTimestamp = Math.floor(new Date(oldestMessage.Info.Timestamp).getTime() / 1000)

    try {
      const msgs = await FetchMessagesPaged(chatId, PAGE_SIZE, beforeTimestamp)
      if (msgs && msgs.length > 0) {
        // Decrement the Virtuoso anchor by the number prepended so it keeps the
        // current scroll position instead of jumping. Virtuoso handles the rest.
        setFirstItemIndex(prev => prev - msgs.length)
        prependMessages(chatId, msgs)
        setHasMore(msgs.length >= PAGE_SIZE)
      } else {
        setHasMore(false)
      }
    } catch (err) {
      console.error("Load more failed:", err)
    } finally {
      setIsLoadingMore(false)
    }
  }, [chatId, hasMore, isLoadingMore, messages, prependMessages])

  useEffect(() => {
    if (isAtBottom) {
      const currentMessages = messages[chatId] || []
      const messageIds = currentMessages.map((m: any) => m?.Info?.ID).filter((id: any) => !!id)
      if (messageIds.length > 0) {
        MarkRead(chatId, messageIds, "read-msg").catch(err => {
          console.error("Failed to mark messages as read:", err)
        })
      }
    }
  }, [isAtBottom, chatId])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setInputText(newValue)
    if (selectedMentions.length > 0) {
      setSelectedMentions(prev =>
        prev.filter(mention => {
          let name = mention.full_name
          if (!name) {
            if (mention.push_name) {
              name = `~ ${mention.push_name}`
            } else {
              name = mention.short || mention.phno
            }
          }
          return newValue.includes(`@${name}`)
        }),
      )
    }

    if (!isComposingRef.current) {
      isComposingRef.current = true
      setTypingIndicator(chatId, true)
      SendChatPresence(chatId, "composing", "").catch(() => {})
    }

    if (typingTimeout) clearTimeout(typingTimeout)
    const timeout = setTimeout(() => {
      isComposingRef.current = false
      SendChatPresence(chatId, "paused", "").catch(() => {})
      setTypingIndicator(chatId, false)
    }, 1500)
    setTypingTimeout(timeout)
  }

  const handleSendMessage = async () => {
    if (!inputText.trim() && !pastedImage && !selectedFile) return

    const textToSend = inputText
    const imageToSend = pastedImage
    const fileToSend = selectedFile
    const fileTypeToSend = selectedFileType
    const quotedMessageId = replyingTo?.Info.ID

    // Generate a temporary ID for optimistic update
    const tempId = `temp-${Date.now()}-${Math.random()}`

    // Create pending message
    const pendingMessage: any = {
      tempId,
      isPending: true,
      Info: {
        ID: tempId,
        IsFromMe: true,
        Timestamp: new Date().toISOString(),
        PushName: "You",
        Sender: "",
      },
      Content: {},
    }

    // Set content based on message type
    if (imageToSend) {
      pendingMessage.Content = {
        imageMessage: {
          caption: textToSend || "",
          mimetype: "image/png",
        },
      }
    } else if (fileToSend) {
      if (fileTypeToSend === "video") {
        pendingMessage.Content = {
          videoMessage: {
            caption: textToSend || "",
            mimetype: fileToSend.type,
          },
        }
      } else if (fileTypeToSend === "audio") {
        pendingMessage.Content = {
          audioMessage: {
            mimetype: fileToSend.type,
          },
        }
      } else {
        pendingMessage.Content = {
          documentMessage: {
            caption: textToSend || "",
            fileName: fileToSend.name,
            mimetype: fileToSend.type,
          },
        }
      }
    } else {
      pendingMessage.Content = {
        conversation: textToSend,
      }
    }

    // Add quoted message if replying
    if (quotedMessageId && replyingTo) {
      const contextInfo = {
        quotedMessage: replyingTo.Content,
        participant: replyingTo.Info.Sender,
        stanzaId: replyingTo.Info.ID,
      }

      if (pendingMessage.Content.conversation) {
        pendingMessage.Content = {
          extendedTextMessage: {
            text: pendingMessage.Content.conversation,
            contextInfo,
          },
        }
        delete pendingMessage.Content.conversation
      } else if (pendingMessage.Content.imageMessage) {
        pendingMessage.Content.imageMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.videoMessage) {
        pendingMessage.Content.videoMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.audioMessage) {
        pendingMessage.Content.audioMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.documentMessage) {
        pendingMessage.Content.documentMessage.contextInfo = contextInfo
      }
    }

    // Add pending message to store immediately
    addPendingMessage(chatId, pendingMessage)

    // Clear input
    setInputText("")
    setPastedImage(null)
    setSelectedFile(null)
    setReplyingTo(null)
    setSelectedMentions([])

    // Scroll to bottom to show the new message
    requestAnimationFrame(() => {
      scrollToBottom(false)
    })

    let processedText = textToSend
    const mentionsToSend: string[] = []
    if (selectedMentions.length > 0) {
      const sortedMentions = [...selectedMentions].sort((a, b) => {
        let nameA = a.full_name
        if (!nameA) nameA = a.push_name ? `~ ${a.push_name}` : a.short || a.phno

        let nameB = b.full_name
        if (!nameB) nameB = b.push_name ? `~ ${b.push_name}` : b.short || b.phno

        return nameB.length - nameA.length
      })

      for (const mention of sortedMentions) {
        let name = mention.full_name
        if (!name) {
          if (mention.push_name) {
            name = `~ ${mention.push_name}`
          } else {
            name = mention.short || mention.phno
          }
        }
        const mentionText = `@${name}`

        if (processedText.includes(mentionText)) {
          const userPart = mention.jid.split("@")[0]
          const replacement = `@${userPart}`

          processedText = processedText.replaceAll(mentionText, replacement)

          mentionsToSend.push(mention.jid)
        }
      }
    }

    try {
      if (imageToSend) {
        const base64 = imageToSend.split(",")[1]
        await SendMessage(chatId, {
          type: "image",
          base64Data: base64,
          text: processedText,
          quotedMessageId,
          mentions: mentionsToSend,
        })
      } else if (fileToSend) {
        const reader = new FileReader()
        reader.onload = async event => {
          const base64 = (event.target?.result as string).split(",")[1]
          await SendMessage(chatId, {
            type: fileTypeToSend,
            base64Data: base64,
            text: processedText,
            quotedMessageId,
            mentions: mentionsToSend,
          })
        }
        reader.readAsDataURL(fileToSend)
      } else {
        await SendMessage(chatId, {
          type: "text",
          text: processedText,
          quotedMessageId,
          mentions: mentionsToSend,
        })
      }
    } catch (err) {
      console.error("Failed to send:", err)
      // Optionally, mark message as failed or remove it
    }
  }

  useEffect(() => {
    setActiveChatId(chatId)
    loadInitialMessages()
  }, [chatId, loadInitialMessages, setActiveChatId])

  useEffect(() => {
    // New messages from events still use the old Message format for real-time updates
    // They will be compatible due to the Info and Content structure
    const unsub = EventsOn("wa:new_message", (data: { chatId: string; message: any }) => {
      if (data?.chatId === chatId) {
        // Use getState to avoid depending on messages array and causing re-subscriptions
        const currentMessages = useMessageStore.getState().messages[chatId] || []
        const hasPendingMessage = currentMessages.some((m: any) => m.isPending)

        if (hasPendingMessage && data.message.Info?.IsFromMe) {
          // Find and replace the most recent pending message
          const pendingMessages = currentMessages.filter((m: any) => m.isPending)
          if (pendingMessages.length > 0) {
            const lastPending = pendingMessages[pendingMessages.length - 1]
            updatePendingMessageToSent(data.chatId, lastPending.tempId, data.message)
          } else {
            updateMessage(data.chatId, data.message)
          }
        } else {
          updateMessage(data.chatId, data.message)
        }

        if (isAtBottom) {
          requestAnimationFrame(() => {
            scrollToBottom(false)
          })
        }
      }
    })

    return () => unsub()
  }, [chatId, updateMessage, updatePendingMessageToSent, scrollToBottom, isAtBottom])

  useGSAP(() => {
    if (!scrollButtonRef.current) return

    if (isAtBottom) {
      gsap.to(scrollButtonRef.current, {
        opacity: 0,
        duration: 0.3,
        ease: easeHideRef.current,
      })
    } else {
      gsap.to(scrollButtonRef.current, {
        opacity: 1,
        duration: 0.3,
        ease: easeShowRef.current,
      })
    }
  }, [isAtBottom])

  return (
    <div className="flex h-full min-w-0">
      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader
          chatName={chatName}
          chatSubtitle={chatSubtitle}
          chatAvatar={chatAvatar}
          onBack={onBack}
          onInfoClick={() => setChatInfoOpen(!chatInfoOpen)}
        />

        {/* Pinned-messages banner: shows the latest pin, click cycles through
            pins newest-first and jumps to each message (WhatsApp behavior). */}
        {pinnedMessages.length > 0 && (
          <div
            onClick={() => {
              const idx = pinnedCycleRef.current % pinnedMessages.length
              const target = pinnedMessages[pinnedMessages.length - 1 - idx]
              pinnedCycleRef.current = idx + 1
              handleQuotedClick(target.message_id)
            }}
            className="flex items-center gap-2 border-b border-gray-200 bg-light-secondary px-4 py-2 text-sm cursor-pointer dark:border-white/5 dark:bg-dark-bg"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              className="shrink-0 fill-current text-[#1b9a58] dark:text-[#21c063]"
            >
              <path d="M16 3a1 1 0 0 1 .95 1.31l-.9 2.72 3.42 3.42a1 1 0 0 1-.21 1.57l-3.62 2.07-1.9 4.75a1 1 0 0 1-1.64.33L9 16.07l-4.29 4.3-1.42-1.42 4.3-4.29-3.1-3.1a1 1 0 0 1 .33-1.64l4.75-1.9 2.07-3.62A1 1 0 0 1 12.5 4z" />
            </svg>
            <span
              className="flex-1 truncate text-gray-700 dark:text-gray-200 [&_*]:inline"
              dangerouslySetInnerHTML={{
                __html: pinnedMessages[pinnedMessages.length - 1].text || "Pinned message",
              }}
            />
            {pinnedMessages.length > 1 && (
              <span className="shrink-0 text-xs text-gray-500 dark:text-[#8696a0]">
                {pinnedMessages.length}
              </span>
            )}
          </div>
        )}

        <div className="flex-1 relative overflow-hidden">
          {/* Static chat wallpaper: painted once behind the list instead of
              scrolling (and repainting) with it — big scroll-perf win. */}
          <div className="chat-wallpaper absolute inset-0 pointer-events-none z-0" />
          {(initialLoad || !isReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#efeae2] dark:bg-[#0a0a0a] z-50">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
            </div>
          )}

          <button
            ref={scrollButtonRef}
            onClick={() => scrollToBottom(false)}
            className="absolute bottom-4 right-8 bg-white dark:bg-received-bubble-dark-bg p-2 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 z-100 hover:bg-gray-100 dark:hover:bg-[#2a3942]"
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              className="fill-current text-gray-600 dark:text-gray-400"
            >
              <path d="M12 16.17L4.83 9L3.41 10.41L12 19L20.59 10.41L19.17 9L12 16.17Z" />
            </svg>
          </button>

          <div className={clsx("relative z-10 h-full", (!isReady || initialLoad) && "invisible")}>
            <MessageList
              key={`${chatId}:${isReady ? "ready" : "loading"}`}
              ref={messageListRef}
              chatId={chatId}
              messages={chatMessages}
              firstItemIndex={firstItemIndex}
              sentMediaCache={sentMediaCache}
              onReply={setReplyingTo}
              onQuotedClick={handleQuotedClick}
              onLoadMore={loadMoreMessages}
              onAtBottomChange={handleAtBottomChange}
              pinnedIds={pinnedIds}
              isLoading={isLoadingMore}
              hasMore={hasMore}
              highlightedMessageId={highlightedMessageId}
            />
          </div>
        </div>
        <ChatInput
          chatId={chatId}
          inputText={inputText}
          pastedImage={pastedImage}
          selectedFile={selectedFile}
          selectedFileType={selectedFileType}
          showEmojiPicker={showEmojiPicker}
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          emojiPickerRef={emojiPickerRef}
          emojiButtonRef={emojiButtonRef}
          replyingTo={replyingTo}
          mentionableContacts={mentionableContacts}
          onInputChange={handleInputChange}
          onKeyDown={e =>
            e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSendMessage())
          }
          onPaste={async e => {
            // Chromium exposes pasted images synchronously via DataTransfer.
            const items = e.clipboardData?.items
            for (const item of items || []) {
              if (item.type.indexOf("image") !== -1) {
                const file = item.getAsFile()
                if (file) {
                  e.preventDefault()
                  setPastedImage(await blobToDataURL(file))
                  return
                }
              }
            }

            // WebKitGTK (Wails on Linux) does not put system-clipboard images
            // into DataTransfer, so fall back to the async Clipboard API.
            if (!navigator.clipboard?.read) return
            try {
              const clipboardItems = await navigator.clipboard.read()
              for (const clipboardItem of clipboardItems) {
                const imageType = clipboardItem.types.find(t => t.startsWith("image/"))
                if (imageType) {
                  const blob = await clipboardItem.getType(imageType)
                  setPastedImage(await blobToDataURL(blob))
                  return
                }
              }
            } catch (err) {
              console.error("Clipboard image read failed:", err)
            }
          }}
          onSendMessage={handleSendMessage}
          onFileSelect={e => {
            const file = e.target.files?.[0]
            if (file) {
              setSelectedFile(file)
              setSelectedFileType(file.type.split("/")[0])
            }
          }}
          onRemoveFile={() => {
            setSelectedFile(null)
            setPastedImage(null)
          }}
          onEmojiClick={emoji => {
            setInputText(prev => prev + emoji)
            setShowEmojiPicker(false)
          }}
          onToggleEmojiPicker={() => setShowEmojiPicker(!showEmojiPicker)}
          onCancelReply={() => setReplyingTo(null)}
          onMentionAdd={contact => setSelectedMentions(prev => [...prev, contact])}
          selectedMentions={selectedMentions}
        />
      </div>

      <ChatInfo
        chatId={chatId}
        chatName={chatName}
        chatType={chatType}
        chatAvatar={chatAvatar}
        isOpen={chatInfoOpen}
        onClose={() => setChatInfoOpen(false)}
      />
    </div>
  )
}
