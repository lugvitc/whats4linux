import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { useContactStore } from "./useContactStore"

interface MessageStore {
  messages: Record<string, any[]>
  activeChatId: string | null
  setActiveChatId: (chatId: string) => void
  setMessages: (chatId: string, messages: any[]) => void
  addMessage: (chatId: string, message: any) => void
  prependMessages: (chatId: string, messages: any[]) => void
  updateMessage: (chatId: string, message: any) => void
  addReactionToMessage: (
    chatId: string,
    messageId: string,
    emoji: string,
    senderId: string,
  ) => void
  clearMessages: (chatId: string) => void
  trimOldMessages: (chatId: string, keepCount: number) => void
  addPendingMessage: (chatId: string, message: any) => void
  updatePendingMessageToSent: (chatId: string, tempId: string, message: any) => void
}

export const useMessageStore = create<MessageStore>()(
  immer((set, get) => ({
    messages: {},
    activeChatId: null,

    setActiveChatId: chatId => {
      const prevChatId = get().activeChatId

      set(state => {
        if (prevChatId && prevChatId !== chatId) {
          // keep only last 10 messages of previous chat (for quick switching)
          if (state.messages[prevChatId]) {
            state.messages[prevChatId] = state.messages[prevChatId].slice(-10)
          }

          // dispose contact name cache for old chat context
          useContactStore.getState().disposeCache()
        }
        state.activeChatId = chatId
      })
    },

    setMessages: (chatId, messages) =>
      set(state => {
        state.messages[chatId] = messages
      }),

    addMessage: (chatId, message) =>
      set(state => {
        if (!state.messages[chatId]) state.messages[chatId] = []
        state.messages[chatId].push(message)
      }),

    prependMessages: (chatId, messages) =>
      set(state => {
        const existing = state.messages[chatId] || []
        state.messages[chatId] = [...messages, ...existing]
      }),

    updateMessage: (chatId, message) =>
      set(state => {
        if (!state.messages[chatId]) state.messages[chatId] = []

        const idx = state.messages[chatId].findIndex(m => m.Info?.ID === message.Info?.ID)

        if (idx >= 0) {
          state.messages[chatId][idx] = message
        } else {
          state.messages[chatId].push(message)
        }
      }),

    // Optimistically set/clear a sender's reaction on a message (empty emoji
    // removes it). One reaction per sender.
    addReactionToMessage: (chatId, messageId, emoji, senderId) =>
      set(state => {
        const msgs = state.messages[chatId]
        if (!msgs) return
        const idx = msgs.findIndex((m: any) => m.Info?.ID === messageId)
        if (idx < 0) return
        const msg = msgs[idx]
        // Dedupe by the phone-number part so an optimistic reaction replaces a
        // previously-synced one from the same person (which carries a full JID).
        const uid = (s: string) => (s || "").split("@")[0].split(":")[0]
        const target = uid(senderId)
        const others = (msg.reactions || []).filter((r: any) => uid(r.sender_id) !== target)
        msg.reactions = emoji
          ? [...others, { id: 0, message_id: messageId, sender_id: senderId, emoji }]
          : others
      }),

    trimOldMessages: (chatId, keepCount) =>
      set(state => {
        if (state.messages[chatId] && state.messages[chatId].length > keepCount) {
          state.messages[chatId] = state.messages[chatId].slice(-keepCount)
        }
      }),

    clearMessages: chatId =>
      set(state => {
        delete state.messages[chatId]
      }),

    addPendingMessage: (chatId, message) =>
      set(state => {
        if (!state.messages[chatId]) state.messages[chatId] = []
        state.messages[chatId].push(message)
      }),

    updatePendingMessageToSent: (chatId, tempId, message) =>
      set(state => {
        if (!state.messages[chatId]) return

        const idx = state.messages[chatId].findIndex(m => m.tempId === tempId)

        if (idx >= 0) {
          state.messages[chatId][idx] = message
        } else {
          // Fallback: If tempId not found, use updateMessage logic
          const existingIdx = state.messages[chatId].findIndex(m => m.Info?.ID === message.Info?.ID)
          if (existingIdx >= 0) {
            state.messages[chatId][existingIdx] = message
          } else {
            state.messages[chatId].push(message)
          }
        }
      }),
  })),
)
