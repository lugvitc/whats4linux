import { create } from "zustand"
import { GetSettings, SaveSettings } from "../../wailsjs/go/api/Api"
import { DEFAULT_EASES, THEME, applyThemeColors } from "../theme.config"
import { cacheTheme, normalizeTheme, readCachedTheme } from "../lib/theme"
import { useEaseStore } from "./useEaseStore"

interface AppSettingsStore extends AppSettings {
  loaded: boolean

  loadSettings: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  updateThemeColor: (group: keyof typeof THEME, label: string, value: string) => Promise<void>
  toggleTheme: () => Promise<void>
}

export interface AppSettings {
  // Theme
  theme: "light" | "dark"
  themeColors: typeof THEME
  eases: typeof DEFAULT_EASES

  // Privacy Settings
  readReceipts: boolean
  blockUnknown: boolean
  disableLinkPreviews: boolean

  // Notifications Settings
  messageNotifications: boolean
  showPreviews: boolean
  showReactionNotifications: boolean
  statusReactions: boolean
  callNotifications: boolean
  incomingCallSounds: boolean
  incomingSounds: boolean
  outgoingSounds: boolean

  // General Settings
  minimizeToTray: boolean
  language: string
  fontSize: string

  // Chats Settings
  spellCheck: boolean
  replaceTextWithEmojis: boolean
  enterIsSend: boolean
}

const defaultSettings: AppSettings = {
  theme: "light",
  themeColors: THEME,
  eases: DEFAULT_EASES,
  readReceipts: true,
  blockUnknown: false,
  disableLinkPreviews: false,

  messageNotifications: true,
  showPreviews: true,
  showReactionNotifications: true,
  statusReactions: true,
  callNotifications: true,
  incomingCallSounds: true,
  incomingSounds: true,
  outgoingSounds: true,

  minimizeToTray: true,
  language: "English",
  fontSize: "100% (Default)",

  spellCheck: true,
  replaceTextWithEmojis: true,
  enterIsSend: false,
}

function extractSettings(state: AppSettingsStore): AppSettings {
  const { loaded, ...settings } = state
  return settings
}

// Backfill defaults into a stored eases object so groups/actions added in newer
// builds (e.g. CallOverlay) keep working on existing installs.
function mergeEases(saved?: AppSettings["eases"]): typeof DEFAULT_EASES {
  const merged = {} as typeof DEFAULT_EASES
  for (const [group, actions] of Object.entries(DEFAULT_EASES)) {
    ;(merged as any)[group] = {
      ...actions,
      ...(saved?.[group as keyof typeof DEFAULT_EASES] ?? {}),
    }
  }
  return merged
}

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  ...defaultSettings,
  loaded: false,

  loadSettings: async () => {
    try {
      const saved = await GetSettings()

      const merged = {
        ...defaultSettings,
        ...(saved ?? {}),
      }
      merged.eases = mergeEases(merged.eases)
      merged.theme = normalizeTheme(merged.theme)

      // Older builds shipped a black light-mode toggle knob (#000000) as the
      // default and persisted it into saved settings. Rewrite that stale
      // default to white so existing installs pick up the readable knob.
      const savedToggleCircle: string | undefined = merged.themeColors?.Button?.["toggle circle"]
      if (savedToggleCircle === "#000000") {
        merged.themeColors = {
          ...merged.themeColors,
          Button: { ...merged.themeColors.Button, "toggle circle": "#ffffff" },
        }
      }

      applyThemeColors(merged.themeColors)
      useEaseStore.setState({ eases: merged.eases })
      cacheTheme(merged.theme)

      set({
        ...merged,
        loaded: true,
      })
    } catch (err) {
      // fallback to defaults, but keep the locally cached theme so a backend
      // failure does not flip a dark-mode user back to light
      applyThemeColors(defaultSettings.themeColors)
      useEaseStore.setState({ eases: defaultSettings.eases })

      set({ theme: readCachedTheme(), loaded: true })
    }
  },

  updateSetting: async (key, value) => {
    set(state => {
      const next = { ...state, [key]: value }

      if (key === "theme") {
        cacheTheme(next.theme)
      }

      SaveSettings(extractSettings(next)).catch(err => {
        console.error("Failed to save setting:", err)
      })

      return next
    })
  },

  toggleTheme: async () => {
    const theme = get().theme === "light" ? "dark" : "light"
    await get().updateSetting("theme", theme)
  },

  updateThemeColor: async (group, label, value) => {
    set(state => {
      const next = {
        ...state,
        themeColors: {
          ...state.themeColors,
          [group]: {
            ...state.themeColors[group],
            [label]: value,
          },
        },
      }

      // ⭐ apply to CSS
      applyThemeColors(next.themeColors)

      // ⭐ persist
      SaveSettings(extractSettings(next)).catch(console.error)

      return next
    })
  },
}))
