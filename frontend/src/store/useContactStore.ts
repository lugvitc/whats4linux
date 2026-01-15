import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { GetContact, GetJIDUser, GetProfileColor } from "../../wailsjs/go/api/Api"

interface ContactStore {
  contacts: Record<string, { name: string; senderColor: string; timestamp: number }>
  getContactName: (jid: any) => Promise<string>
  getContactColor: (jid: any) => Promise<string>
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

    disposeCache: () =>
      set(state => {
        state.contacts = {}
      }),
  })),
)
