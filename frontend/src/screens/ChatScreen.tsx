import { useEffect, useRef, useCallback } from "react"
import clsx from "clsx"
import { GetChatList } from "../../wailsjs/go/api/Api"
import { api } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { ChatDetail } from "./ChatDetail"
import { useChatStore } from "../store"
import type { ChatItem } from "../store/types"
import {
  GroupIcon,
  UserAvatar,
  NewChatIcon,
  MenuIcon,
  EmptyStateIcon,
} from "../assets/svgs/chat_icons"
import { SearchIcon } from "../assets/svgs/settings_icons"

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
}

const Header = ({ onOpenSettings }: HeaderProps) => (
  <div className="h-16 bg-light-secondary dark:bg-dark-secondary flex items-center justify-between px-4 border-b border-gray-200 dark:border-dark-tertiary">
    <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden">
      <UserAvatar />
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
  <div className="p-2 bg-white dark:bg-black border-b border-gray-200 dark:border-dark-tertiary">
    <div className="bg-light-secondary dark:bg-dark-tertiary rounded-lg flex items-center px-4 py-2">
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

interface ChatListItemProps {
  chat: ChatItem
  isSelected: boolean
  onSelect: (chat: ChatItem) => void
}

const ChatListItem = ({ chat, isSelected, onSelect }: ChatListItemProps) => (
  <div
    onClick={() => onSelect(chat)}
    className={clsx(
      "flex items-center p-3 cursor-pointer divide-white/75 divide-y",
      "hover:bg-gray-100 dark:hover:bg-dark-tertiary",
      isSelected && "bg-gray-200 dark:bg-[#2a2a2a]",
    )}
  >
    <div className="w-12 h-12 rounded-full bg-gray-300 dark:bg-gray-600 mr-4 shrink-0 overflow-hidden flex items-center justify-center">
      <ChatAvatar chat={chat} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex justify-between items-baseline mb-1">
        <h3 className="text-light-text dark:text-dark-text font-medium truncate">{chat.name}</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">Yesterday</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{chat.subtitle}</p>
    </div>
  </div>
)

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
  const {
    chats,
    selectedChatId,
    selectedChatName,
    selectedChatAvatar,
    searchTerm,
    setChats,
    selectChat,
    setSearchTerm,
    clearUnreadCount,
  } = useChatStore()

  const isFetchingRef = useRef(false)
  const mountedRef = useRef(true)

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

  const transformChatElements = useCallback((chatElements: api.ChatElement[]): ChatItem[] => {
    return chatElements.map(c => {
      const isGroup = c.jid?.endsWith("@g.us") || false
      const avatar = c.avatar_url || ""
      return {
        id: c.jid || "",
        name: c.full_name || c.push_name || c.short || c.jid || "Unknown",
        subtitle: c.latest_message || "",
        type: isGroup ? "group" : "contact",
        avatar: avatar,
      }
    })
  }, [])

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

      const items = transformChatElements(chatElements)
      setChats(items)
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

    const timeout = setTimeout(fetchChats, 100)
    const unsub = EventsOn("wa:new_message", () => {
      setTimeout(fetchChats, 500)
    })

    return () => {
      mountedRef.current = false
      clearTimeout(timeout)
      unsub()
    }
  }, [fetchChats])

  const filteredChats = chats.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))

  return (
    <div className="flex h-screen bg-light-secondary dark:bg-black overflow-hidden">
      {/* Chat List Sidebar */}
      <div
        className={clsx(
          "flex-col w-full md:w-100",
          "border-r border-gray-200 dark:border-dark-tertiary",
          "bg-white dark:bg-black h-full",
          selectedChatId ? "hidden md:flex" : "flex",
        )}
      >
        <Header onOpenSettings={onOpenSettings} />
        <SearchBar value={searchTerm} onChange={setSearchTerm} />

        <div className="flex-1 overflow-y-auto">
          {filteredChats.length === 0 ? (
            <EmptyState
              hasChats={chats.length > 0}
              isLoading={isFetchingRef.current}
              onRefresh={fetchChats}
            />
          ) : (
            filteredChats.map(chat => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                isSelected={selectedChatId === chat.id}
                onSelect={handleChatSelect}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat Detail */}
      <div
        className={clsx(
          "flex-1 flex-col h-full",
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
      </div>
    </div>
  )
}
