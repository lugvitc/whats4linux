import { useEffect, useRef, useCallback, memo } from "react"
import clsx from "clsx"
import { GetChatList, GetCachedAvatar, GetSelfAvatar } from "../../wailsjs/go/api/Api"
import { api } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { ChatDetail } from "./ChatDetail"
import { useChatStore, useChatById, useFilteredChatIds } from "../store"
import { useSelfAvatarStore } from "../store/useSelfAvatarStore"
import type { ChatItem } from "../store/types"
import {
  GroupIcon,
  UserAvatar,
  NewChatIcon,
  MenuIcon,
  EmptyStateIcon,
} from "../assets/svgs/chat_icons"
import { SearchIcon } from "../assets/svgs/settings_icons"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../components/common/resizable"
import { useContactStore } from "@/store/useContactStore"

const USE_SAMPLE_DATA = false

const SAMPLE_CHATS: ChatItem[] = [
  {
    id: "1234567890@s.whatsapp.net",
    name: "John Doe",
    subtitle: "Hey! How are you doing?",
    type: "contact",
    avatar: "",
  },
  {
    id: "0987654321@s.whatsapp.net",
    name: "Jane Smith",
    subtitle: "Thanks for your help yesterday!",
    type: "contact",
    avatar: "",
  },
  {
    id: "group123@g.us",
    name: "Project Team",
    subtitle: "Alice: The meeting is at 3 PM",
    type: "group",
    avatar: "",
  },
  {
    id: "5551234567@s.whatsapp.net",
    name: "Mike Johnson",
    subtitle: "Can you send me that file?",
    type: "contact",
    avatar: "",
  },
  {
    id: "group456@g.us",
    name: "Family Group",
    subtitle: "Mom: Dinner at 7 tonight",
    type: "group",
    avatar: "",
  },
  {
    id: "7778889999@s.whatsapp.net",
    name: "Sarah Williams",
    subtitle: "See you tomorrow!",
    type: "contact",
    avatar: "",
  },
]

interface ChatAvatarProps {
  chat: ChatItem
}

const ChatAvatar = ({ chat }: ChatAvatarProps) => {
  if (chat.avatar) {
    return <img src={chat.avatar} alt={chat.name} className="w-full h-full object-cover" />
  }

  return chat.type === "group" ? <GroupIcon /> : <UserAvatar />
}

interface HeaderProps {
  onOpenSettings: () => void
  avatar?: string
}

const Header = ({ onOpenSettings, avatar }: HeaderProps) => (
  <div className="h-16 bg-light-secondary dark:bg-dark-secondary flex items-center justify-between px-4 border-b border-gray-200 dark:border-dark-tertiary">
    <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden flex items-center justify-center">
      {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : <UserAvatar />}
    </div>
    <div className="flex gap-4 text-gray-500 dark:text-gray-400">
      <button title="New Chat" className="hover:bg-hover-icons p-2 rounded-full">
        <NewChatIcon />
      </button>
      <button
        title="Menu"
        onClick={onOpenSettings}
        className="hover:bg-hover-icons p-2 rounded-full"
      >
        <MenuIcon />
      </button>
    </div>
  </div>
)

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

const SearchBar = ({ value, onChange }: SearchBarProps) => (
  <div className="p-2 bg-light-bg dark:bg-dark-bg border-b border-gray-200 dark:border-dark-tertiary">
    <div className="bg-light-tertiary dark:bg-dark-tertiary rounded-full flex items-center px-4 py-2">
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

interface ChatListItemContentProps {
  chat: ChatItem
  isSelected: boolean
  onSelect: (chat: ChatItem) => void
}

// Pure presentational component - memoized to prevent unnecessary re-renders
const ChatListItemContent = memo(({ chat, isSelected, onSelect }: ChatListItemContentProps) => (
  <div
    onClick={() => onSelect(chat)}
    className={clsx(
      "flex items-center p-3 cursor-pointer divide-white/75 divide-y rounded-xl m-3",
      "hover:bg-gray-100 dark:hover:bg-dark-tertiary",
      isSelected && "bg-gray-200 dark:bg-[#2a2a2a]",
    )}
  >
    <div className="w-12 h-12 rounded-full bg-gray-300 dark:bg-gray-600 mr-4 shrink-0 overflow-hidden flex items-center justify-center">
      <MemoizedChatAvatar avatar={chat.avatar} type={chat.type} name={chat.name} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex justify-between items-baseline mb-1">
        <h3 className="text-light-text dark:text-dark-text font-medium truncate">{chat.name}</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {chat.timestamp
            ? new Date(chat.timestamp * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "yesterday"}
        </span>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400 truncate [&_p]:inline [&_p]:m-0 ">
        {chat.sender && chat.type === "group" && <span className="mr-1">{chat.sender}: </span>}
        <span
          className="[&_br]:hidden no-formatting"
          dangerouslySetInnerHTML={{ __html: chat.subtitle }}
        />
      </div>
    </div>
  </div>
))

ChatListItemContent.displayName = "ChatListItemContent"

interface ChatListItemProps {
  chatId: string
  isSelected: boolean
  onSelect: (chat: ChatItem) => void
}

// Container component that subscribes to specific chat data
const ChatListItem = memo(({ chatId, isSelected, onSelect }: ChatListItemProps) => {
  // This hook only triggers re-render when THIS specific chat changes
  const chat = useChatById(chatId)

  if (!chat) return null

  return <ChatListItemContent chat={chat} isSelected={isSelected} onSelect={onSelect} />
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

  const fetchChats = useCallback(async () => {
    if (isFetchingRef.current) return

    isFetchingRef.current = true

    try {
      if (USE_SAMPLE_DATA) {
        setChats(SAMPLE_CHATS)
        return
      }

      const chatElements = await GetChatList()

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
      if (mountedRef.current && USE_SAMPLE_DATA) {
        setChats(SAMPLE_CHATS)
      } else {
        setChats([])
      }
    } finally {
      isFetchingRef.current = false
    }
  }, [setChats, transformChatElements])

  useEffect(() => {
    mountedRef.current = true

    // Initial fetch
    const timeout = setTimeout(fetchChats, 100)

    // Listen for new messages - update only the specific chat
    const unsubNewMessage = EventsOn(
      "wa:new_message",
      (data: { chatId: string; messageText: string; timestamp: number; sender: string }) => {
        if (!initialFetchDoneRef.current) {
          // If we haven't done initial fetch, do a full fetch
          setTimeout(fetchChats, 500)
          return
        }

        // Check if we already have this chat in our list
        const existingChat = getChat(data.chatId)
        if (existingChat) {
          // Update only this specific chat - no full re-fetch needed!
          updateChatLastMessage(data.chatId, data.messageText, data.timestamp, data.sender)
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
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Chat List Sidebar */}
        <ResizablePanel
          defaultSize={30}
          minSize={300}
          maxSize={1000}
          className={clsx(
            "flex-col",
            "border-r border-gray-200 dark:border-dark-tertiary",
            "bg-white dark:bg-dark-bg h-full",
            selectedChatId ? "hidden md:flex" : "flex",
          )}
        >
          <Header onOpenSettings={onOpenSettings} avatar={selfAvatar} />
          <SearchBar value={searchTerm} onChange={setSearchTerm} />

          <div className="flex-1 overflow-y-auto">
            {filteredChatIds.length === 0 ? (
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
                />
              ))
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Chat Detail */}
        <ResizablePanel
          defaultSize={70}
          className={clsx(
            "flex-col h-full",
            "bg-[#efeae2] dark:bg-dark-secondary relative",
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
