import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { GetContact, GetJIDUser } from "../../wailsjs/go/api/Api"

interface ContactStore {
  contacts: Record<string, { name: string; timestamp: number }>
  getContactName: (jid: any) => Promise<string>
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

        set(state => {
          state.contacts[userId] = {
            name: displayName,
            timestamp: Date.now(),
          }
        })
        return displayName
      } catch {
        return userId
      }
    },

    disposeCache: () =>
      set(state => {
        state.contacts = {}
      }),
  })),
)
