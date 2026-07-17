import { useEffect, useRef, useCallback, useState, memo } from "react"
import clsx from "clsx"
import {
  GetChatList,
  GetChannelList,
  GetCachedAvatar,
  GetSelfAvatar,
  ToggleChatPin,
} from "../../wailsjs/go/api/Api"
import { api } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { ChatDetail } from "./ChatDetail"
import { useChatStore, useChatById, useFilteredChatIds } from "../store"
import { useSelfAvatarStore } from "../store/useSelfAvatarStore"
import { useChatMuted } from "../store/useMuteStore"
import type { ChatItem } from "../store/types"
import { StatusList, StoryViewer, type StatusGroup } from "../components/chat/Status"
import {
  GroupIcon,
  UserAvatar,
  NewChatIcon,
  MenuIcon,
  EmptyStateIcon,
  MutedBellIcon,
} from "../assets/svgs/chat_icons"
import { SearchIcon } from "../assets/svgs/settings_icons"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../components/common/resizable"
import { useContactStore } from "@/store/useContactStore"

interface HeaderProps {
  onOpenSettings: () => void
  avatar?: string
}

const Header = ({ onOpenSettings, avatar }: HeaderProps) => (
  <div className="h-16 bg-light-secondary dark:bg-dark-bg flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/5">
    <h1 className="text-xl font-bold text-light-text dark:text-white">WhatsApp</h1>
    <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
      <button
        title="New Chat"
        className="hover:bg-gray-100 dark:hover:bg-white/10 p-2 rounded-full"
      >
        <NewChatIcon />
      </button>
      <button
        title="Menu"
        onClick={onOpenSettings}
        className="hover:bg-gray-100 dark:hover:bg-white/10 p-2 rounded-full"
      >
        <MenuIcon />
      </button>
      <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden flex items-center justify-center ml-2">
        {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : <UserAvatar />}
      </div>
    </div>
  </div>
)

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

const SearchBar = ({ value, onChange }: SearchBarProps) => (
  <div className="px-3 py-2 bg-light-bg dark:bg-dark-bg">
    <div className="bg-light-tertiary dark:bg-[#242626] rounded-full flex items-center px-4 py-2">
      <div className="text-gray-500 dark:text-gray-400 mr-4">
        <SearchIcon />
      </div>
      <input
        type="text"
        placeholder="Search or start new chat"
        className="bg-transparent border-none outline-none text-sm w-full text-light-text dark:text-dark-text placeholder-gray-500"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  </div>
)

// Memoized ChatAvatar - only re-renders if avatar changes
const MemoizedChatAvatar = memo(
  ({ avatar, type, name }: { avatar?: string; type: "group" | "contact"; name: string }) => {
    if (avatar) {
      return <img src={avatar} alt={name} className="w-full h-full object-cover" />
    }
    return type === "group" ? <GroupIcon /> : <UserAvatar />
  },
)

MemoizedChatAvatar.displayName = "MemoizedChatAvatar"

// Small WhatsApp-style pin glyph shown on pinned chat rows.
const PinIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" className={clsx("fill-current", className)}>
    <path d="M16 3a1 1 0 0 1 .95 1.31l-.9 2.72 3.42 3.42a1 1 0 0 1-.21 1.57l-3.62 2.07-1.9 4.75a1 1 0 0 1-1.64.33L9 16.07l-4.29 4.3-1.42-1.42 4.3-4.29-3.1-3.1a1 1 0 0 1 .33-1.64l4.75-1.9 2.07-3.62A1 1 0 0 1 12.5 4z" />
  </svg>
)

interface ChatListItemContentProps {
  chat: ChatItem
  muted: boolean
  isSelected: boolean
  onSelect: (chat: ChatItem) => void
  onContextMenu: (e: React.MouseEvent, chat: ChatItem) => void
}

// Pure presentational component - memoized to prevent unnecessary re-renders
const ChatListItemContent = memo(
  ({ chat, muted, isSelected, onSelect, onContextMenu }: ChatListItemContentProps) => (
    <div
      onClick={() => onSelect(chat)}
      onContextMenu={e => onContextMenu(e, chat)}
      className={clsx(
        "flex items-center px-4 py-3 cursor-pointer",
        "hover:bg-gray-100 dark:hover:bg-[#202121]",
        isSelected && "bg-gray-200 dark:bg-[#2e2f2f]",
      )}
    >
      <div className="w-12 h-12 rounded-full bg-gray-300 dark:bg-gray-600 mr-4 shrink-0 overflow-hidden flex items-center justify-center">
        <MemoizedChatAvatar avatar={chat.avatar} type={chat.type} name={chat.name} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline mb-1">
          <h3 className="text-light-text dark:text-dark-text font-medium truncate">{chat.name}</h3>
          <div className="flex items-center gap-1 shrink-0">
            {muted && (
              <span className="text-gray-500 dark:text-[#8696a0]">
                <MutedBellIcon />
              </span>
            )}
            <span
              className={clsx(
                "text-xs",
                chat.unreadCount
                  ? "font-medium text-[#1b9a58] dark:text-[#21c063]"
                  : "text-gray-500 dark:text-[#8696a0]",
              )}
            >
              {chat.timestamp
                ? new Date(chat.timestamp * 1000).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "yesterday"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 text-sm text-gray-500 dark:text-[#8696a0] truncate [&_p]:inline [&_p]:m-0 ">
            {chat.sender && chat.type === "group" && <span className="mr-1">{chat.sender}: </span>}
            <span
              className="[&_br]:hidden no-formatting"
              dangerouslySetInnerHTML={{ __html: chat.subtitle }}
            />
          </div>
          {chat.pinned && <PinIcon className="shrink-0 text-gray-400 dark:text-[#8696a0]" />}
          {chat.unreadCount ? (
            <span className="shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center rounded-full bg-[#21c063] text-[#0a1014] text-xs font-semibold">
              {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  ),
)

ChatListItemContent.displayName = "ChatListItemContent"

interface ChatListItemProps {
  chatId: string
  isSelected: boolean
  onSelect: (chat: ChatItem) => void
  onContextMenu: (e: React.MouseEvent, chat: ChatItem) => void
}

// Container component that subscribes to specific chat data
const ChatListItem = memo(({ chatId, isSelected, onSelect, onContextMenu }: ChatListItemProps) => {
  // This hook only triggers re-render when THIS specific chat changes
  const chat = useChatById(chatId)
  // Boolean selector - only re-renders when THIS chat's muted flag flips
  const muted = useChatMuted(chatId)

  if (!chat) return null

  return (
    <ChatListItemContent
      chat={chat}
      muted={muted}
      isSelected={isSelected}
      onSelect={onSelect}
      onContextMenu={onContextMenu}
    />
  )
})

ChatListItem.displayName = "ChatListItem"

interface EmptyStateProps {
  hasChats: boolean
  isLoading: boolean
  onRefresh: () => void
}

const EmptyState = ({ hasChats, isLoading, onRefresh }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 p-8">
    <p className="text-center">
      {hasChats ? "No chats match your search." : "No chats available. Start a conversation!"}
    </p>
    <button
      onClick={onRefresh}
      disabled={isLoading}
      className="mt-4 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
    >
      {isLoading ? "Loading..." : "Refresh Chats"}
    </button>
  </div>
)

const WelcomeScreen = () => (
  <div className="flex-1 flex flex-col items-center justify-center z-10 text-center px-10 border-b-[6px] border-[#43d187]">
    <div className="mb-8">
      <EmptyStateIcon />
    </div>
    <h1 className="text-3xl font-light text-gray-600 dark:text-gray-300 mb-4">
      WhatsApp for Linux
    </h1>
    <p className="text-gray-500 dark:text-gray-400">
      Send and receive messages without keeping your phone online.
      <br />
      Use WhatsApp on up to 4 linked devices and 1 phone.
    </p>
  </div>
)

interface ChatListScreenProps {
  onOpenSettings: () => void
}

export function ChatListScreen({ onOpenSettings }: ChatListScreenProps) {
  // Use individual selectors to minimize re-renders
  const selectedChatId = useChatStore(state => state.selectedChatId)
  const selectedChatName = useChatStore(state => state.selectedChatName)
  const selectedChatAvatar = useChatStore(state => state.selectedChatAvatar)
  const searchTerm = useChatStore(state => state.searchTerm)
  const setChats = useChatStore(state => state.setChats)
  const selfAvatar = useSelfAvatarStore(state => state.selfAvatar)
  const setSelfAvatar = useSelfAvatarStore(state => state.setSelfAvatar)
  const selectChat = useChatStore(state => state.selectChat)
  const setSearchTerm = useChatStore(state => state.setSearchTerm)
  const clearUnreadCount = useChatStore(state => state.clearUnreadCount)
  const updateChatLastMessage = useChatStore(state => state.updateChatLastMessage)
  const updateSingleChat = useChatStore(state => state.updateSingleChat)
  const getChat = useChatStore(state => state.getChat)
  const getContactName = useContactStore(state => state.getContactName)

  // Get filtered chat IDs - only re-renders when IDs or search changes, not on message/timestamp updates
  const filteredChatIds = useFilteredChatIds()
  const totalChats = useChatStore(state => state.chatIds.length)

  const isFetchingRef = useRef(false)
  const mountedRef = useRef(true)
  const initialFetchDoneRef = useRef(false)

  const handleChatSelect = useCallback(
    (chat: ChatItem) => {
      selectChat(chat)
      clearUnreadCount(chat.id)
    },
    [selectChat, clearUnreadCount],
  )

  const handleBack = useCallback(() => {
    selectChat(null)
  }, [selectChat])

  const transformChatElements = useCallback(
    async (chatElements: api.ChatElement[]): Promise<ChatItem[]> => {
      return Promise.all(
        chatElements.map(async c => {
          const isGroup = c.jid?.endsWith("@g.us") || false
          const avatar = c.avatar_url || ""
          const senderName = c.Sender ? await getContactName(c.Sender) : ""

          return {
            id: c.jid || "",
            name: c.full_name || c.push_name || c.short || c.phno || "Unknown",
            subtitle: c.latest_message || "",
            type: isGroup ? "group" : "contact",
            timestamp: c.LatestTS,
            avatar: avatar,
            sender: senderName || "",
            pinned: c.pinned || false,
          }
        }),
      )
    },
    [getContactName],
  )

  const loadAvatars = useCallback(
    async (chatItems: ChatItem[]) => {
      const chatsNeedingAvatars = chatItems.filter(c => !c.avatar)

      if (chatsNeedingAvatars.length === 0) return

      // Can change this later but
      // 5 works well for now.
      const CONCURRENCY = 5
      let index = 0

      const worker = async () => {
        while (index < chatsNeedingAvatars.length) {
          const chat = chatsNeedingAvatars[index++]

          try {
            const avatarURL = await GetCachedAvatar(chat.id, false)
            if (avatarURL && mountedRef.current) {
              useChatStore.getState().updateSingleChat(chat.id, { avatar: avatarURL })
            }
          } catch (err) {
            console.error("Avatar load failed:", chat.id, err)
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    },
    [updateSingleChat],
  )

  const loadSelfAvatar = useCallback(async () => {
    try {
      const avatarURL = await GetSelfAvatar(false)

      if (!mountedRef.current) {
        console.log("Component unmounted, aborting self avatar set")
        return
      }

      setSelfAvatar(avatarURL)
    } catch (err) {
      console.error("Failed to load self avatar:", err)
    }
  }, [setSelfAvatar])

  const [view, setView] = useState<"chats" | "channels" | "status">("chats")
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number; chat: ChatItem } | null>(null)

  const handleChatContextMenu = useCallback((e: React.MouseEvent, chat: ChatItem) => {
    e.preventDefault()
    setChatMenu({ x: e.clientX, y: e.clientY, chat })
  }, [])

  // Dismiss the chat context menu on any click outside it.
  useEffect(() => {
    if (!chatMenu) return
    const close = () => setChatMenu(null)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [chatMenu])

  const handleTogglePin = useCallback(async () => {
    if (!chatMenu) return
    const { chat } = chatMenu
    setChatMenu(null)
    const store = useChatStore.getState()
    // Optimistic: flip locally and re-sort; backend refresh confirms.
    store.updateSingleChat(chat.id, { pinned: !chat.pinned })
    store.resortChats()
    try {
      await ToggleChatPin(chat.id, !chat.pinned)
    } catch (err) {
      console.error("Failed to toggle chat pin:", err)
      store.updateSingleChat(chat.id, { pinned: chat.pinned })
      store.resortChats()
    }
  }, [chatMenu])
  const [storyGroup, setStoryGroup] = useState<StatusGroup | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const fetchChats = useCallback(async () => {
    if (isFetchingRef.current) return

    isFetchingRef.current = true

    try {
      const chatElements =
        viewRef.current === "channels" ? await GetChannelList() : await GetChatList()

      if (!mountedRef.current) return

      if (!chatElements || !Array.isArray(chatElements)) {
        setChats([])
        return
      }

      const items = await transformChatElements(chatElements)
      setChats(items)
      // Load avatars asynchronously without blocking the UI
      loadAvatars(items)
      loadSelfAvatar()
      initialFetchDoneRef.current = true
    } catch (err) {
      console.error("Error fetching chats:", err)
      setChats([])
    } finally {
      isFetchingRef.current = false
    }
  }, [setChats, transformChatElements])

  // Reload the list (and drop the open chat) when switching Chats/Channels.
  const viewInitRef = useRef(true)
  useEffect(() => {
    if (viewInitRef.current) {
      viewInitRef.current = false
      return
    }
    selectChat(null)
    setChats([])
    // Status has its own data path (grouped stories); don't load it as a chat list.
    if (view !== "status") fetchChats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  useEffect(() => {
    mountedRef.current = true

    // Initial fetch
    const timeout = setTimeout(fetchChats, 100)

    // Listen for new messages - update only the specific chat
    const unsubNewMessage = EventsOn(
      "wa:new_message",
      (data: {
        chatId: string
        messageText: string
        timestamp: number
        sender: string
        reaction?: string
        isFromMe?: boolean
      }) => {
        // Mark an incoming message unread unless it belongs to the chat that's
        // currently open. Read state via getState() to avoid a stale closure.
        if (!data.isFromMe && useChatStore.getState().selectedChatId !== data.chatId) {
          useChatStore.getState().incrementUnreadCount(data.chatId)
        }

        if (!initialFetchDoneRef.current) {
          // If we haven't done initial fetch, do a full fetch
          setTimeout(fetchChats, 500)
          return
        }

        // Check if we already have this chat in our list
        const existingChat = getChat(data.chatId)
        if (existingChat) {
          let previewText = data.messageText
          let senderForUpdate = data.sender
          if (data.reaction) {
            previewText = `${data.sender} reacted ${data.reaction} to: "${previewText}"`
            senderForUpdate = ""
          }

          // Update only this specific chat - no full re-fetch needed!
          updateChatLastMessage(data.chatId, previewText, data.timestamp, senderForUpdate)
        } else {
          // New chat we don't have - need to fetch to get avatar/name
          setTimeout(fetchChats, 500)
        }
      },
    )

    const unsubPictureUpdate = EventsOn("wa:picture_update", async (jid: string) => {
      if (!jid) return

      try {
        const avatarURL = await GetCachedAvatar(jid, true)

        updateSingleChat(jid, { avatar: avatarURL })

        if (selectedChatId === jid) {
          const existing = getChat(jid)
          if (existing) {
            selectChat({ ...existing, avatar: avatarURL })
          }
        }
      } catch (err) {
        console.error("Error updating avatar for", jid, err)
      }
    })

    // Fallback: listen for generic updates that require full refresh
    const unsubRefresh = EventsOn("wa:chat_list_refresh", () => {
      setTimeout(fetchChats, 500)
    })

    return () => {
      mountedRef.current = false
      clearTimeout(timeout)
      unsubNewMessage()
      unsubPictureUpdate()
      unsubRefresh()
    }
  }, [fetchChats, getChat, loadSelfAvatar, updateChatLastMessage, updateSingleChat])

  return (
    <div className="flex h-screen bg-light-secondary dark:bg-black overflow-hidden">
      {chatMenu && (
        <div
          className="fixed z-50 min-w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#242626]"
          style={{ top: chatMenu.y, left: chatMenu.x }}
        >
          <button
            onClick={handleTogglePin}
            className="w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5"
          >
            {chatMenu.chat.pinned ? "Unpin chat" : "Pin chat"}
          </button>
        </div>
      )}
      <ResizablePanelGroup className="h-full">
        {/* Chat List Sidebar */}
        <ResizablePanel
          defaultSize="30%"
          minSize="320px"
          maxSize="600px"
          className={clsx(
            "flex-col",
            "border-r border-gray-200 dark:border-dark-tertiary",
            "bg-white dark:bg-dark-bg h-full",
            selectedChatId ? "hidden md:flex" : "flex",
          )}
        >
          <Header onOpenSettings={onOpenSettings} avatar={selfAvatar} />
          <div className="flex gap-2 px-3 pb-2 pt-1">
            {(["chats", "channels", "status"] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={clsx(
                  "rounded-full border px-3 py-1 text-sm capitalize transition-colors",
                  view === v
                    ? "border-transparent bg-[#d9fdd3] font-medium text-[#0a1014] dark:bg-[#21c063]"
                    : "border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-white/10 dark:text-[#8696a0] dark:hover:bg-white/5",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <SearchBar value={searchTerm} onChange={setSearchTerm} />

          <div className="flex-1 overflow-y-auto">
            {view === "status" ? (
              <StatusList onOpen={setStoryGroup} />
            ) : filteredChatIds.length === 0 ? (
              <EmptyState
                hasChats={totalChats > 0}
                isLoading={isFetchingRef.current}
                onRefresh={fetchChats}
              />
            ) : (
              filteredChatIds.map(chatId => (
                <ChatListItem
                  key={chatId}
                  chatId={chatId}
                  isSelected={selectedChatId === chatId}
                  onSelect={handleChatSelect}
                  onContextMenu={handleChatContextMenu}
                />
              ))
            )}
          </div>
        </ResizablePanel>
        {storyGroup && <StoryViewer group={storyGroup} onClose={() => setStoryGroup(null)} />}

        <ResizableHandle />

        {/* Chat Detail */}
        <ResizablePanel
          defaultSize="70%"
          minSize="400px"
          className={clsx(
            "flex-col h-full",
            "bg-[#efeae2] dark:bg-[#0a0a0a] relative",
            selectedChatId ? "flex" : "hidden md:flex",
          )}
        >
          {selectedChatId ? (
            <ChatDetail
              chatId={selectedChatId}
              chatName={selectedChatName}
              chatAvatar={selectedChatAvatar}
              onBack={handleBack}
            />
          ) : (
            <WelcomeScreen />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
