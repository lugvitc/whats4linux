import { useEffect, useState, useRef, useCallback } from "react"
import { SendMessage, FetchMessagesPaged, SendChatPresence } from "../../wailsjs/go/api/Api"
import { store } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { useMessageStore, useUIStore } from "../store"
import { MessageList, type MessageListHandle } from "../components/chat/MessageList"
import { ChatHeader } from "../components/chat/ChatHeader"
import { ChatInput } from "../components/chat/ChatInput"
import clsx from "clsx"
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
  const { setTypingIndicator, showEmojiPicker, setShowEmojiPicker } = useUIStore()

  const chatMessages = messages[chatId] || []
  const [inputText, setInputText] = useState("")
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFileType, setSelectedFileType] = useState<string>("")
  const [replyingTo, setReplyingTo] = useState<store.Message | null>(null)
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)

  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)

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

  useEffect(() => {
    easeShowRef.current = getEase("DropDown", "open")
    easeHideRef.current = getEase("DropDown", "close")
  })

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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)

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

    // Scroll to bottom to show the new message
    requestAnimationFrame(() => {
      scrollToBottom(false)
    })

    try {
      if (imageToSend) {
        const base64 = imageToSend.split(",")[1]
        await SendMessage(chatId, {
          type: "image",
          base64Data: base64,
          text: textToSend,
          quotedMessageId,
        })
      } else if (fileToSend) {
        const reader = new FileReader()
        reader.onload = async event => {
          const base64 = (event.target?.result as string).split(",")[1]
          await SendMessage(chatId, {
            type: fileTypeToSend,
            base64Data: base64,
            text: textToSend,
            quotedMessageId,
          })
        }
        reader.readAsDataURL(fileToSend)
      } else {
        await SendMessage(chatId, { type: "text", text: textToSend, quotedMessageId })
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
    const unsub = EventsOn("wa:new_message", (data: { chatId: string; message: store.Message }) => {
      if (data?.chatId === chatId) {
        // Check if this message replaces a pending message
        const currentMessages = messages[chatId] || []
        const hasPendingMessage = currentMessages.some((m: any) => m.isPending)

        if (hasPendingMessage && data.message.Info.IsFromMe) {
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
  }, [chatId, updateMessage, updatePendingMessageToSent, scrollToBottom, messages, isAtBottom])

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
    //trim the message list to last 20 messages when at bottom
    if (isAtBottom) {
      const currentMessages = messages[chatId] || []
      if (currentMessages.length > 50) {
        setMessages(chatId, currentMessages.slice(-25))
      }
    }
  }, [isAtBottom])

  return (
    <div className="flex flex-col h-full bg-[#efeae2] dark:bg-[#0b141a]">
      <ChatHeader chatName={chatName} chatAvatar={chatAvatar} onBack={onBack} />

      <div className="flex-1 relative overflow-hidden">
        {(initialLoad || !isReady) && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#efeae2] dark:bg-[#0b141a] z-50">
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

        <div className={clsx("h-full", (!isReady || initialLoad) && "invisible")}>
          <MessageList
            ref={messageListRef}
            chatId={chatId}
            messages={chatMessages}
            sentMediaCache={sentMediaCache}
            onReply={setReplyingTo}
            onQuotedClick={handleQuotedClick}
            onLoadMore={loadMoreMessages}
            onAtBottomChange={handleAtBottomChange}
            isLoading={isLoadingMore}
            hasMore={hasMore}
            highlightedMessageId={highlightedMessageId}
          />
        </div>
      </div>

      <ChatInput
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
        onInputChange={handleInputChange}
        onKeyDown={e =>
          e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSendMessage())
        }
        onPaste={async e => {
          const items = e.clipboardData?.items
          for (const item of items || []) {
            if (item.type.indexOf("image") !== -1) {
              const file = item.getAsFile()
              if (file) {
                const reader = new FileReader()
                reader.onload = event => setPastedImage(event.target?.result as string)
                reader.readAsDataURL(file)
              }
            }
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
      />
    </div>
  )
}
