import { create } from "zustand"
import { DEFAULT_EASES } from "../theme.config"
import { SaveSettings } from "../../wailsjs/go/api/Api"
import { useAppSettingsStore } from "./useAppSettingsStore"

export type EaseGroup = keyof typeof DEFAULT_EASES
export type EaseAction<G extends EaseGroup = EaseGroup> = keyof (typeof DEFAULT_EASES)[G]

type EaseStore = {
  eases: typeof DEFAULT_EASES
  updateEase: <G extends EaseGroup>(group: G, action: EaseAction<G>, ease: string) => Promise<void>
}

export const getEase = <G extends EaseGroup>(group: G, action: EaseAction<G>) =>
  useEaseStore.getState().eases[group][action]

export const useEaseStore = create<EaseStore>((set, get) => ({
  eases: DEFAULT_EASES,

  updateEase: async (group, action, ease) => {
    set(state => {
      const next = {
        ...state.eases,
        [group]: {
          ...state.eases[group],
          [action]: ease,
        },
      }

      const app = useAppSettingsStore.getState()
      const { loaded, ...settings } = app

      SaveSettings({ ...settings, eases: next }).catch(console.error)

      return { eases: next }
    })
  },
}))

export const setEase = useEaseStore.getState().updateEase
