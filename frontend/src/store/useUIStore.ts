import { create } from "zustand"

interface UIStore {
  sidebarOpen: boolean
  showEmojiPicker: boolean
  typingIndicators: Record<string, boolean>
  onlineStatus: Record<string, boolean>
  notifications: Array<{ id: number; message: string }>
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setShowEmojiPicker: (show: boolean) => void
  setTypingIndicator: (chatId: string, isTyping: boolean) => void
  setOnlineStatus: (userId: string, isOnline: boolean) => void
  addNotification: (message: string) => number
  removeNotification: (id: number) => void
}

export const useUIStore = create<UIStore>(set => ({
  sidebarOpen: true,
  showEmojiPicker: false,
  typingIndicators: {},
  onlineStatus: {},
  notifications: [],

  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: open => set({ sidebarOpen: open }),
  setShowEmojiPicker: show => set({ showEmojiPicker: show }),

  setTypingIndicator: (chatId, isTyping) =>
    set(state => ({
      typingIndicators: { ...state.typingIndicators, [chatId]: isTyping },
    })),

  setOnlineStatus: (userId, isOnline) =>
    set(state => ({
      onlineStatus: { ...state.onlineStatus, [userId]: isOnline },
    })),

  addNotification: message => {
    const id = Date.now()
    set(state => ({
      notifications: [...state.notifications, { id, message }],
    }))
    return id
  },

  removeNotification: id =>
    set(state => ({
      notifications: state.notifications.filter(n => n.id !== id),
    })),
}))
