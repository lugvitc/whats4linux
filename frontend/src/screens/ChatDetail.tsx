import { useEffect, useState, useRef, useCallback } from "react"
import { SendMessage, FetchMessagesPaged, SendChatPresence } from "../../wailsjs/go/api/Api"
import { store } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { useMessageStore, useUIStore } from "../store"
import { MessageList, type MessageListHandle } from "../components/chat/MessageList"
import { ChatHeader } from "../components/chat/ChatHeader"
import { ChatInput } from "../components/chat/ChatInput"

interface ChatDetailProps {
  chatId: string
  chatName: string
  chatAvatar?: string
  onBack?: () => void
}

export function ChatDetail({ chatId, chatName, chatAvatar, onBack }: ChatDetailProps) {
  const { messages, setMessages, updateMessage, prependMessages, setActiveChatId } =
    useMessageStore()
  const { setTypingIndicator, showEmojiPicker, setShowEmojiPicker } = useUIStore()

  const chatMessages = messages[chatId] || []
  const [inputText, setInputText] = useState("")
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFileType, setSelectedFileType] = useState<string>("")
  const [replyingTo, setReplyingTo] = useState<store.Message | null>(null)
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)

  const START_INDEX = 100000
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX)
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)

  const messageListRef = useRef<MessageListHandle>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sentMediaCache = useRef<Map<string, string>>(new Map())
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)

  const scrollToBottom = useCallback((instant = false) => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToBottom(instant ? "auto" : "smooth")
    })
  }, [])

  const loadInitialMessages = useCallback(() => {
    setInitialLoad(true)
    // Load latest 50 messages
    FetchMessagesPaged(chatId, 50, 0)
      .then((msgs: store.Message[]) => {
        const loadedMsgs = msgs || []
        setMessages(chatId, loadedMsgs)
        setHasMore(loadedMsgs.length >= 50)
        setFirstItemIndex(START_INDEX)
        // Small delay to ensure DOM is ready
        setTimeout(() => scrollToBottom(true), 100)
      })
      .catch(console.error)
      .finally(() => setInitialLoad(false))
  }, [chatId, setMessages, scrollToBottom])

  const loadMoreMessages = useCallback(() => {
    if (!hasMore || isLoadingMore) return

    const currentMessages = messages[chatId] || []
    if (currentMessages.length === 0) return

    setIsLoadingMore(true)
    const oldestMessage = currentMessages[0]

    // Convert ISO string to unix timestamp (seconds)
    const beforeTimestamp = oldestMessage
      ? Math.floor(new Date(oldestMessage.Info.Timestamp).getTime() / 1000)
      : 0

    FetchMessagesPaged(chatId, 50, beforeTimestamp)
      .then((msgs: store.Message[]) => {
        if (msgs && msgs.length > 0) {
          prependMessages(chatId, msgs)
          setFirstItemIndex(prev => prev - msgs.length)
          setHasMore(msgs.length >= 50)
        } else {
          setHasMore(false)
        }
      })
      .catch(console.error)
      .finally(() => setIsLoadingMore(false))
  }, [chatId, hasMore, isLoadingMore, messages, prependMessages])

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = Math.min(textarea.scrollHeight, 192) + "px"
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    adjustTextareaHeight()

    setTypingIndicator(chatId, true)
    SendChatPresence(chatId, "composing", "").catch(() => {})

    if (typingTimeout) clearTimeout(typingTimeout)
    const timeout = setTimeout(() => {
      SendChatPresence(chatId, "paused", "").catch(() => {})
      setTypingIndicator(chatId, false)
    }, 1500)
    setTypingTimeout(timeout)
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = event => {
          setPastedImage(event.target?.result as string)
          setTimeout(adjustTextareaHeight, 0)
        }
        reader.readAsDataURL(file)
        break
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    if (file.type.startsWith("image/")) setSelectedFileType("image")
    else if (file.type.startsWith("video/")) setSelectedFileType("video")
    else if (file.type.startsWith("audio/")) setSelectedFileType("audio")
    else setSelectedFileType("document")
  }

  const removeSelectedFile = () => {
    setSelectedFile(null)
    setPastedImage(null)
    setSelectedFileType("")
    if (fileInputRef.current) fileInputRef.current.value = ""
    setTimeout(adjustTextareaHeight, 0)
  }

  const handleEmojiClick = (emoji: string) => {
    setInputText(prev => prev + emoji)
    setShowEmojiPicker(false)
    textareaRef.current?.focus()
    setTimeout(adjustTextareaHeight, 0)
  }

  const buildContextInfo = (): any | undefined => {
    if (!replyingTo) return undefined

    const sender = replyingTo.Info.Sender
    const participant = sender?.User
      ? `${sender.User}@${sender.Server || "s.whatsapp.net"}`
      : chatId

    return {
      stanzaID: replyingTo.Info.ID,
      participant,
      remoteJID: chatId,
      quotedMessage: replyingTo.Content,
    }
  }

  const handleSendMessage = async () => {
    if (!inputText.trim() && !pastedImage && !selectedFile) return

    const textToSend = inputText
    const imageToSend = pastedImage
    const fileToSend = selectedFile
    const fileTypeToSend = selectedFileType
    const quotedMessageId = replyingTo?.Info.ID
    const contextInfo = buildContextInfo()

    setInputText("")
    setPastedImage(null)
    setSelectedFile(null)
    setSelectedFileType("")
    setReplyingTo(null)
    if (textareaRef.current) textareaRef.current.style.height = "auto"

    const tempId = `temp-${Date.now()}`
    const tempMsg: any = {
      Info: { ID: tempId, IsFromMe: true, Timestamp: new Date().toISOString() },
      Content: imageToSend
        ? { imageMessage: { caption: textToSend, _tempImage: imageToSend, contextInfo } }
        : fileToSend
          ? {
              [`${fileTypeToSend}Message`]: {
                caption: textToSend,
                _tempFile: fileToSend,
                contextInfo,
              },
            }
          : replyingTo
            ? { extendedTextMessage: { text: textToSend, contextInfo } }
            : { conversation: textToSend },
    }

    setMessages(chatId, [...chatMessages, tempMsg])
    scrollToBottom()

    try {
      if (imageToSend) {
        const base64 = imageToSend.split(",")[1]
        const newId = await SendMessage(chatId, {
          type: "image",
          base64Data: base64,
          text: textToSend,
          quotedMessageId,
        })
        if (newId) sentMediaCache.current.set(newId, imageToSend)
      } else if (fileToSend) {
        const reader = new FileReader()
        reader.onload = async event => {
          const base64 = (event.target?.result as string).split(",")[1]
          const newId = await SendMessage(chatId, {
            type: fileTypeToSend,
            base64Data: base64,
            text: textToSend,
            quotedMessageId,
          })
          if (newId) sentMediaCache.current.set(newId, event.target?.result as string)
        }
        reader.readAsDataURL(fileToSend)
      } else {
        await SendMessage(chatId, { type: "text", text: textToSend, quotedMessageId })
      }
    } catch (err) {
      console.error("Failed to send:", err)
      setMessages(chatId, chatMessages)
      setInputText(textToSend)
      setReplyingTo(replyingTo)
    }
  }

  useEffect(() => {
    setActiveChatId(chatId)
    setFirstItemIndex(START_INDEX)
    setHasMore(true)
    setIsLoadingMore(false)
    loadInitialMessages()
  }, [chatId, loadInitialMessages, setActiveChatId])

  // Listen for new messages
  useEffect(() => {
    const unsub = EventsOn("wa:new_message", (data: { chatId: string; message: store.Message }) => {
      if (data?.chatId && data?.message) {
        updateMessage(data.chatId, data.message)
        // Auto-scroll when new message arrives in current chat
        if (data.chatId === chatId) {
          scrollToBottom(false)
        }
      }
    })
    return () => unsub()
  }, [chatId, updateMessage, scrollToBottom])

  useEffect(() => {
    setReplyingTo(null)
    setInputText("")
    setPastedImage(null)
    setSelectedFile(null)
    setSelectedFileType("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }, [chatId])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false)
      }
    }
    if (showEmojiPicker) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showEmojiPicker])

  return (
    <div className="flex flex-col h-full bg-[#efeae2] dark:bg-[#0b141a]">
      <ChatHeader chatName={chatName} chatAvatar={chatAvatar} onBack={onBack} />
      <MessageList
        ref={messageListRef}
        chatId={chatId}
        messages={chatMessages}
        sentMediaCache={sentMediaCache}
        onReply={setReplyingTo}
        onLoadMore={loadMoreMessages}
        firstItemIndex={firstItemIndex}
        isLoading={isLoadingMore || initialLoad}
        hasMore={hasMore}
      />
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
        onPaste={handlePaste}
        onSendMessage={handleSendMessage}
        onFileSelect={handleFileSelect}
        onRemoveFile={removeSelectedFile}
        onEmojiClick={handleEmojiClick}
        onToggleEmojiPicker={() => setShowEmojiPicker(!showEmojiPicker)}
        onCancelReply={() => setReplyingTo(null)}
      />
    </div>
  )
}
