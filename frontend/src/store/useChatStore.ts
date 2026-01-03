import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { useCallback } from "react"
import type { ChatItem } from "./types"

interface ChatStore {
  // Use a Map for O(1) lookups and granular updates
  chatsById: Map<string, ChatItem>
  // Keep ordered list of chat IDs for rendering order
  chatIds: string[]
  selectedChatId: string | null
  selectedChatName: string
  selectedChatAvatar?: string
  selectedChatSender?: string
  searchTerm: string
  // Actions
  setChats: (chats: ChatItem[]) => void
  selectChat: (chat: ChatItem | null) => void
  setSearchTerm: (term: string) => void
  updateChatLastMessage: (
    chatId: string,
    message: string,
    timestamp?: number,
    sender?: string,
  ) => void
  updateSingleChat: (chatId: string, updates: Partial<ChatItem>) => void
  incrementUnreadCount: (chatId: string) => void
  clearUnreadCount: (chatId: string) => void
  getChat: (chatId: string) => ChatItem | undefined
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chatsById: new Map(),
  chatIds: [],
  selectedChatId: null,
  selectedChatName: "",
  selectedChatAvatar: undefined,
  selectedChatSender: undefined,
  searchTerm: "",

  setChats: chats => {
    const newChatsById = new Map<string, ChatItem>()
    const newChatIds: string[] = []

    for (const chat of chats) {
      newChatsById.set(chat.id, chat)
      newChatIds.push(chat.id)
    }

    set({ chatsById: newChatsById, chatIds: newChatIds })
  },

  selectChat: chat =>
    set({
      selectedChatId: chat?.id || null,
      selectedChatName: chat?.name || "",
      selectedChatAvatar: chat?.avatar,
      selectedChatSender: chat?.sender,
    }),

  setSearchTerm: term => set({ searchTerm: term }),

  // Update only a single chat without replacing the entire Map
  updateSingleChat: (chatId, updates) =>
    set(state => {
      const existingChat = state.chatsById.get(chatId)
      if (!existingChat) return state

      const newChatsById = new Map(state.chatsById)
      newChatsById.set(chatId, { ...existingChat, ...updates })

      return { chatsById: newChatsById }
    }),

  updateChatLastMessage: (chatId, message, timestamp, sender) =>
    set(state => {
      const existingChat = state.chatsById.get(chatId)
      if (!existingChat) return state

      const newChatsById = new Map(state.chatsById)
      newChatsById.set(chatId, {
        ...existingChat,
        subtitle: message,
        timestamp: timestamp || Date.now(),
        sender: sender || existingChat.sender,
      })

      // Move this chat to the top of the list
      const newChatIds = [chatId, ...state.chatIds.filter(id => id !== chatId)]

      return { chatsById: newChatsById, chatIds: newChatIds }
    }),

  incrementUnreadCount: chatId =>
    set(state => {
      const existingChat = state.chatsById.get(chatId)
      if (!existingChat) return state

      const newChatsById = new Map(state.chatsById)
      newChatsById.set(chatId, {
        ...existingChat,
        unreadCount: (existingChat.unreadCount || 0) + 1,
      })

      return { chatsById: newChatsById }
    }),

  clearUnreadCount: chatId =>
    set(state => {
      const existingChat = state.chatsById.get(chatId)
      if (!existingChat) return state

      const newChatsById = new Map(state.chatsById)
      newChatsById.set(chatId, { ...existingChat, unreadCount: 0 })

      return { chatsById: newChatsById }
    }),

  getChat: chatId => get().chatsById.get(chatId),
}))

// Selector hook to get a single chat by ID - only re-renders when that specific chat changes
export const useChatById = (chatId: string) => {
  return useChatStore(useCallback((state: ChatStore) => state.chatsById.get(chatId), [chatId]))
}

// Selector hook to get only chat IDs (for list rendering) - doesn't re-render on chat content changes
export const useChatIds = () => {
  return useChatStore(useShallow((state: ChatStore) => state.chatIds))
}

// Selector for filtered chat IDs based on search
export const useFilteredChatIds = () => {
  return useChatStore(
    useShallow((state: ChatStore) => {
      const { chatIds, chatsById, searchTerm } = state
      if (!searchTerm) return chatIds

      return chatIds.filter(id => {
        const chat = chatsById.get(id)
        return chat?.name.toLowerCase().includes(searchTerm.toLowerCase())
      })
    }),
  )
}

// Legacy helper to get chats as array (for backward compatibility)
export const useChatsArray = () => {
  return useChatStore(
    useShallow((state: ChatStore) => {
      return state.chatIds.map(id => state.chatsById.get(id)!).filter(Boolean)
    }),
  )
}
