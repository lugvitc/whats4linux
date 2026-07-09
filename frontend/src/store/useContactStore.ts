import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { GetContact, GetJIDUser, GetProfileColor } from "../../wailsjs/go/api/Api"

interface ContactStore {
  contacts: Record<string, { name: string; senderColor: string; timestamp: number }>
  getContactName: (jid: any) => Promise<string>
  getContactColor: (jid: any) => Promise<string>
  getSenderInfo: (jid: string) => Promise<{ name: string; color: string }>
  disposeCache: () => void
}

export const useContactStore = create<ContactStore>()(
  immer((set, get) => ({
    contacts: {},

    getContactName: async jidAny => {
      const userId = await GetJIDUser(jidAny)

      const cached = get().contacts[userId]
      if (cached) return cached.name

      try {
        const contact = await GetContact(jidAny)
        const displayName = contact.full_name || contact.push_name || userId
        const senderColor = await GetProfileColor(jidAny)

        set(state => {
          state.contacts[userId] = {
            name: displayName,
            senderColor,
            timestamp: Date.now(),
          }
        })
        return displayName
      } catch {
        return userId
      }
    },

    getContactColor: async jidAny => {
      const userId = await GetJIDUser(jidAny)

      const cached = get().contacts[userId]
      if (cached) return cached.senderColor

      try {
        const senderColor = await GetProfileColor(jidAny)
        const contact = await GetContact(jidAny)
        const displayName = contact.full_name || contact.push_name || userId

        set(state => {
          state.contacts[userId] = {
            name: displayName,
            senderColor,
            timestamp: Date.now(),
          }
        })
        return senderColor
      } catch {
        return "#2b7fff"
      }
    },

    // Cached name+color for a message sender, keyed by the raw JID so repeated
    // renders while scrolling a group chat don't fire a GetContact/GetJIDUser
    // RPC per message. One fetch per sender, then synchronous cache hits.
    getSenderInfo: async (jid: string) => {
      const cached = get().contacts[jid]
      if (cached) return { name: cached.name, color: cached.senderColor }
      try {
        const contact = await GetContact(jid)
        const name = contact.full_name
          ? contact.full_name
          : contact.push_name
            ? "~ " + contact.push_name
            : ""
        const color = await GetProfileColor(jid)
        set(state => {
          state.contacts[jid] = { name, senderColor: color, timestamp: Date.now() }
        })
        return { name, color }
      } catch {
        return { name: "", color: "#2b7fff" }
      }
    },

    disposeCache: () =>
      set(state => {
        state.contacts = {}
      }),
  })),
)
