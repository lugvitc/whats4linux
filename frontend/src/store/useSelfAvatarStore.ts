import { create } from "zustand"

interface SelfAvatarStore {
  selfAvatar?: string
  setSelfAvatar: (avatar?: string) => void
}

export const useSelfAvatarStore = create<SelfAvatarStore>(set => ({
  setSelfAvatar: avatar => set({ selfAvatar: avatar }),
}))
