import { useEffect, useRef, useCallback, useState, memo } from "react"
import clsx from "clsx"
import {
  GetChatList,
  GetChannelList,
  GetCachedAvatar,
  GetSelfAvatar,
  ToggleChatPin,
  ToggleChatArchive,
} from "../../wailsjs/go/api/Api"
import { api } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { ChatDetail } from "./ChatDetail"
import { useChatStore, useChatById, useFilteredChatIds, useArchivedCount } from "../store"
import { useSelfAvatarStore } from "../store/useSelfAvatarStore"
import { useChatMuted } from "../store/useMuteStore"
import type { ChatItem } from "../store/types"
import { StatusList, StoryViewer, type StatusGroup } from "../components/chat/Status"
import { CallOverlay, useActiveCall } from "../components/chat/CallOverlay"
import { CommunityList, CommunityHome, CommunitiesWelcome } from "../components/chat/Communities"
import {
  getAvatarColor,
  AVATAR_ICON_COLOR,
  AVATAR_ICON_ON_DARK,
  formatChatTimestamp,
} from "../lib/utils"
import { useAppSettingsStore } from "../store/useAppSettingsStore"
import {
  UserAvatar,
  NewChatIcon,
  MenuIcon,
  EmptyStateIcon,
  MutedBellIcon,
} from "../assets/svgs/chat_icons"
import { SearchIcon } from "../assets/svgs/settings_icons"
import { GoBackIcon } from "../assets/svgs/header_icons"
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
  placeholder?: string
}

const SearchBar = ({
  value,
  onChange,
  placeholder = "Search or start new chat",
}: SearchBarProps) => (
  <div className="px-3 py-2 bg-light-bg dark:bg-dark-bg">
    <div className="bg-light-tertiary dark:bg-[#242626] rounded-full flex items-center px-4 py-2">
      <div className="text-gray-500 dark:text-gray-400 mr-4">
        <SearchIcon />
      </div>
      <input
        type="text"
        placeholder={placeholder}
        className="bg-transparent border-none outline-none text-sm w-full text-light-text dark:text-dark-text placeholder-gray-500"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  </div>
)

const PeopleIcon = ({
  size = 24,
  color = AVATAR_ICON_COLOR,
}: {
  size?: number
  color?: string
}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden>
    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
  </svg>
)

// Memoized ChatAvatar — pastel placeholder when no photo (matches WA).
const MemoizedChatAvatar = memo(
  ({
    avatar,
    type,
    name,
    jid,
    dark,
  }: {
    avatar?: string
    type: "group" | "contact"
    name: string
    jid?: string
    dark?: boolean
  }) => {
    if (avatar) {
      return <img src={avatar} alt={name} className="w-full h-full object-cover" />
    }
    const bg = getAvatarColor(jid || name, dark)
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        {type === "group" ? (
          <PeopleIcon size={26} color={AVATAR_ICON_COLOR} />
        ) : (
          <svg
            viewBox="0 0 48 48"
            className="w-full h-full p-1.5"
            fill={AVATAR_ICON_COLOR}
            aria-hidden
          >
            <path d="M24 23q-1.857 0-3.178-1.322Q19.5 20.357 19.5 18.5t1.322-3.178T24 14t3.178 1.322Q28.5 16.643 28.5 18.5t-1.322 3.178T24 23m-6.75 10q-.928 0-1.59-.66-.66-.662-.66-1.59v-.9q0-.956.492-1.758A3.3 3.3 0 0 1 16.8 26.87a16.7 16.7 0 0 1 3.544-1.308q1.8-.435 3.656-.436 1.856 0 3.656.436T31.2 26.87q.816.422 1.308 1.223T33 29.85v.9q0 .928-.66 1.59-.662.66-1.59.66z" />
          </svg>
        )}
      </div>
    )
  },
)

MemoizedChatAvatar.displayName = "MemoizedChatAvatar"

/**
 * WhatsApp community stacked avatar: rounded-square community badge behind a
 * circular group photo.
 */
const CommunityStackedAvatar = memo(
  ({
    communityAvatar,
    groupAvatar,
    communityName,
    groupName,
    communityJid,
    dark,
  }: {
    communityAvatar?: string
    groupAvatar?: string
    communityName: string
    groupName: string
    communityJid?: string
    dark?: boolean
  }) => {
    const communityBg = getAvatarColor(communityJid || communityName, dark)
    // Ring matches chat-list surface so the stack punches out cleanly.
    const ring = dark ? "#161717" : "#ffffff"
    const badge = "w-8 h-8"

    return (
      <div className="relative w-12 h-12 shrink-0 mr-4">
        <div
          className={clsx(
            "absolute left-0 top-0 overflow-hidden flex items-center justify-center rounded-[8px]",
            badge,
          )}
          style={{ backgroundColor: communityBg }}
        >
          {communityAvatar ? (
            <img src={communityAvatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <PeopleIcon size={18} color={AVATAR_ICON_COLOR} />
          )}
        </div>
        <div
          className={clsx(
            "absolute right-0 bottom-0 overflow-hidden flex items-center justify-center rounded-full",
            badge,
          )}
          style={{ boxShadow: `0 0 0 2px ${ring}` }}
        >
          {groupAvatar ? (
            <img src={groupAvatar} alt={groupName} className="w-full h-full object-cover" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ backgroundColor: dark ? "#2a3942" : "#111b21" }}
            >
              <PeopleIcon size={16} color={AVATAR_ICON_ON_DARK} />
            </div>
          )}
        </div>
      </div>
    )
  },
)

CommunityStackedAvatar.displayName = "CommunityStackedAvatar"

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
  ({ chat, muted, isSelected, onSelect, onContextMenu }: ChatListItemContentProps) => {
    const theme = useAppSettingsStore(s => s.theme)
    const dark = theme === "dark"
    const isCommunityChat = Boolean(chat.isCommunityGroup && chat.communityJid)
    const communityName = isCommunityChat ? chat.communityName || "Community" : null

    return (
      <div
        onClick={() => onSelect(chat)}
        onContextMenu={e => onContextMenu(e, chat)}
        className={clsx(
          "flex items-center px-4 py-3 cursor-pointer",
          "hover:bg-gray-100 dark:hover:bg-[#1a1a1a]",
          isSelected && "bg-gray-200 dark:bg-[#242626]",
        )}
      >
        {isCommunityChat ? (
          <CommunityStackedAvatar
            communityAvatar={chat.communityAvatar}
            groupAvatar={chat.avatar}
            communityName={chat.communityName || ""}
            groupName={chat.name}
            communityJid={chat.communityJid}
            dark={dark}
          />
        ) : (
          <div className="w-12 h-12 rounded-full mr-4 shrink-0 overflow-hidden flex items-center justify-center">
            <MemoizedChatAvatar
              avatar={chat.avatar}
              type={chat.type}
              name={chat.name}
              jid={chat.id}
              dark={dark}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          {communityName && (
            <div className="text-[13px] leading-snug text-gray-500 dark:text-[#8696a0] truncate">
              {communityName}
            </div>
          )}
          <div className="flex justify-between items-baseline mb-1">
            <h3 className="text-light-text dark:text-dark-text font-medium truncate">
              {chat.name}
            </h3>
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
                {formatChatTimestamp(chat.timestamp)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-sm text-gray-500 dark:text-[#8696a0] truncate [&_p]:inline [&_p]:m-0 ">
              {chat.sender && chat.type === "group" && (
                <span className="mr-1">{chat.sender}: </span>
              )}
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
    )
  },
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

  const [showArchived, setShowArchived] = useState(false)
  // Get filtered chat IDs - only re-renders when IDs or search changes, not on message/timestamp updates
  const filteredChatIds = useFilteredChatIds(showArchived)
  const archivedCount = useArchivedCount()
  const totalChats = useChatStore(state => state.chatIds.length)

  const isFetchingRef = useRef(false)
  const mountedRef = useRef(true)
  const initialFetchDoneRef = useRef(false)

  type SidebarView = "chats" | "communities" | "channels" | "status"
  const [view, setView] = useState<SidebarView>("chats")
  const [selectedCommunity, setSelectedCommunity] = useState<api.CommunitySummary | null>(null)
  // When opening a group from a community home, remember it so Back returns there.
  const [communityReturn, setCommunityReturn] = useState<api.CommunitySummary | null>(null)

  const handleChatSelect = useCallback(
    (chat: ChatItem) => {
      setSelectedCommunity(null)
      setCommunityReturn(null)
      selectChat(chat)
      clearUnreadCount(chat.id)
    },
    [selectChat, clearUnreadCount],
  )

  const handleCommunitySelect = useCallback(
    (community: api.CommunitySummary) => {
      selectChat(null)
      setCommunityReturn(null)
      setSelectedCommunity(community)
    },
    [selectChat],
  )

  const handleOpenGroupFromCommunity = useCallback(
    (jid: string, name: string, avatar?: string) => {
      if (selectedCommunity) {
        setCommunityReturn(selectedCommunity)
      }
      setSelectedCommunity(null)
      const chat: ChatItem = {
        id: jid,
        name,
        subtitle: "",
        type: "group",
        avatar,
      }
      selectChat(chat)
      clearUnreadCount(jid)
    },
    [selectedCommunity, selectChat, clearUnreadCount],
  )

  const handleBack = useCallback(() => {
    selectChat(null)
    // Return to community home if we came from there.
    if (communityReturn) {
      setSelectedCommunity(communityReturn)
      setCommunityReturn(null)
    }
  }, [selectChat, communityReturn])

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
            archived: c.archived || false,
            communityJid: c.parent_jid || undefined,
            communityName: c.parent_name || undefined,
            isCommunityGroup: Boolean(c.is_community_group && c.parent_jid),
            isCommunityParent: Boolean(c.is_community_parent),
          }
        }),
      )
    },
    [getContactName],
  )

  const loadAvatars = useCallback(
    async (chatItems: ChatItem[]) => {
      // Group avatars + community parent avatars for stacked logos.
      const jobs: Array<{ chatId: string; jid: string; field: "avatar" | "communityAvatar" }> = []
      for (const chat of chatItems) {
        if (!chat.avatar) {
          jobs.push({ chatId: chat.id, jid: chat.id, field: "avatar" })
        }
        if (chat.isCommunityGroup && chat.communityJid && !chat.communityAvatar) {
          jobs.push({ chatId: chat.id, jid: chat.communityJid, field: "communityAvatar" })
        }
      }

      if (jobs.length === 0) return

      const CONCURRENCY = 5
      let index = 0

      const worker = async () => {
        while (index < jobs.length) {
          const job = jobs[index++]

          try {
            const avatarURL = await GetCachedAvatar(job.jid, false)
            if (avatarURL && mountedRef.current) {
              useChatStore.getState().updateSingleChat(job.chatId, { [job.field]: avatarURL })
            }
          } catch (err) {
            console.error("Avatar load failed:", job.jid, err)
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

  // Leave the archived view automatically when the last chat is unarchived,
  // and when switching to Channels/Status tabs.
  useEffect(() => {
    if (showArchived && archivedCount === 0) setShowArchived(false)
  }, [showArchived, archivedCount])
  useEffect(() => {
    if (view !== "chats") setShowArchived(false)
  }, [view])

  // ESC leaves the archived view (and closes the context menu). When a chat
  // is open, ChatDetail's own ESC handler takes precedence — skip here so a
  // single press doesn't trigger both.
  useEffect(() => {
    if (!showArchived && !chatMenu && !selectedCommunity) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (chatMenu) {
        setChatMenu(null)
        return
      }
      if (useChatStore.getState().selectedChatId) return
      if (selectedCommunity) {
        setSelectedCommunity(null)
        return
      }
      setShowArchived(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [showArchived, chatMenu, selectedCommunity])

  const handleToggleArchive = useCallback(async () => {
    if (!chatMenu) return
    const { chat } = chatMenu
    setChatMenu(null)
    const store = useChatStore.getState()
    store.updateSingleChat(chat.id, { archived: !chat.archived })
    try {
      await ToggleChatArchive(chat.id, !chat.archived)
    } catch (err) {
      console.error("Failed to toggle chat archive:", err)
      store.updateSingleChat(chat.id, { archived: chat.archived })
    }
  }, [chatMenu])

  const [storyGroup, setStoryGroup] = useState<StatusGroup | null>(null)
  const { call, active: callActive } = useActiveCall()
  const viewRef = useRef(view)
  viewRef.current = view

  const fetchChats = useCallback(async () => {
    if (isFetchingRef.current) return
    // Communities / status load their own data.
    if (viewRef.current === "communities" || viewRef.current === "status") return

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
    setSelectedCommunity(null)
    setCommunityReturn(null)
    setChats([])
    // Status / communities have their own data paths.
    if (view === "chats" || view === "channels") fetchChats()
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

    // Desktop notification clicks identify the originating chat. Bring that
    // chat into view even if the notification was clicked while minimized.
    const unsubOpenChat = EventsOn("wa:open_chat", async (chatId: string) => {
      if (!chatId) return

      setView("chats")
      setShowArchived(false)
      setSelectedCommunity(null)
      setCommunityReturn(null)

      let chat = useChatStore.getState().getChat(chatId)
      if (!chat) {
        await fetchChats()
        chat = useChatStore.getState().getChat(chatId)
      }
      if (chat) handleChatSelect(chat)
    })

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
      unsubOpenChat()
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
          <button
            onClick={handleToggleArchive}
            className="w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5"
          >
            {chatMenu.chat.archived ? "Unarchive chat" : "Archive chat"}
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
            selectedChatId || selectedCommunity ? "hidden md:flex" : "flex",
          )}
        >
          <Header onOpenSettings={onOpenSettings} avatar={selfAvatar} />
          <div className="flex gap-2 px-3 pb-2 pt-1 overflow-x-auto">
            {(["chats", "communities", "channels", "status"] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={clsx(
                  "rounded-full border px-3 py-1 text-sm capitalize transition-colors shrink-0",
                  view === v
                    ? "border-transparent bg-[#d9fdd3] font-medium text-[#0a1014] dark:bg-[#e9edef] dark:text-[#0b141a]"
                    : "border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-white/10 dark:text-[#8696a0] dark:hover:bg-white/5",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          {view !== "status" && (
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={
                view === "communities"
                  ? "Search communities"
                  : view === "channels"
                    ? "Search channels"
                    : "Search or start new chat"
              }
            />
          )}

          {/* Archived entry (main view) / archived header (archived view) */}
          {!showArchived && view === "chats" && archivedCount > 0 && (
            <button
              onClick={() => setShowArchived(true)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-[#1a1a1a]"
            >
              <span className="flex w-12 justify-center text-[#1b9a58] dark:text-[#21c063]">
                <svg viewBox="0 0 24 24" width="20" height="20" className="fill-current">
                  <path d="M20.54 5.23 19.15 3.55A1.5 1.5 0 0 0 18 3H6a1.5 1.5 0 0 0-1.16.55L3.46 5.23A2 2 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5a2 2 0 0 0-.46-1.27ZM6.24 5h11.52l.81.97H5.44ZM5 19V8h14v11Zm8-5.5V11h-2v2.5H8.5L12 17l3.5-3.5Z" />
                </svg>
              </span>
              <span className="flex-1 font-medium text-light-text dark:text-dark-text">
                Archived
              </span>
              <span className="text-xs text-gray-500 dark:text-[#8696a0]">{archivedCount}</span>
            </button>
          )}
          {showArchived && (
            <div className="flex items-center gap-4 border-b border-gray-200 px-4 py-3 dark:border-white/5">
              <button
                onClick={() => setShowArchived(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                aria-label="Back to chats"
              >
                <GoBackIcon />
              </button>
              <span className="font-medium text-light-text dark:text-dark-text">Archived</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {view === "status" ? (
              <StatusList onOpen={setStoryGroup} />
            ) : view === "communities" ? (
              <CommunityList
                searchTerm={searchTerm}
                selectedJid={selectedCommunity?.jid ?? null}
                onSelect={handleCommunitySelect}
              />
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
          {callActive && <CallOverlay call={call} />}
        </ResizablePanel>
        {storyGroup && <StoryViewer group={storyGroup} onClose={() => setStoryGroup(null)} />}

        <ResizableHandle />

        {/* Chat Detail */}
        <ResizablePanel
          defaultSize="70%"
          minSize="400px"
          className={clsx(
            "flex-col h-full",
            selectedCommunity
              ? "bg-light-secondary dark:bg-dark-bg"
              : "bg-[#efeae2] dark:bg-[#0a0a0a]",
            "relative",
            selectedChatId || selectedCommunity ? "flex" : "hidden md:flex",
          )}
        >
          {selectedChatId ? (
            <ChatDetail
              key={selectedChatId}
              chatId={selectedChatId}
              chatName={selectedChatName}
              chatAvatar={selectedChatAvatar}
              onBack={handleBack}
            />
          ) : selectedCommunity ? (
            <CommunityHome
              communityJid={selectedCommunity.jid}
              communityName={selectedCommunity.name}
              communityAvatar={selectedCommunity.avatar_url}
              onBack={() => setSelectedCommunity(null)}
              onOpenGroup={handleOpenGroupFromCommunity}
            />
          ) : view === "communities" ? (
            <CommunitiesWelcome />
          ) : (
            <WelcomeScreen />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
