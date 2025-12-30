import { create } from "zustand"
import { GetSettings, SaveSettings } from "../../wailsjs/go/api/Api"

interface AppSettings {
  // Theme
  theme: "light" | "dark"

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
  startAtLogin: boolean
  minimizeToTray: boolean
  language: string
  fontSize: string

  // Chats Settings
  spellCheck: boolean
  replaceTextWithEmojis: boolean
  enterIsSend: boolean
}

interface AppSettingsStore extends AppSettings {
  loaded: boolean

  loadSettings: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  toggleTheme: () => Promise<void>
}

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  // Theme
  theme: "light",

  // Privacy Settings
  readReceipts: true,
  blockUnknown: false,
  disableLinkPreviews: false,

  // Notifications Settings
  messageNotifications: true,
  showPreviews: true,
  showReactionNotifications: true,
  statusReactions: true,
  callNotifications: true,
  incomingCallSounds: true,
  incomingSounds: true,
  outgoingSounds: true,

  // General Settings
  startAtLogin: false,
  minimizeToTray: true,
  language: "English",
  fontSize: "100% (Default)",

  // Chats Settings
  spellCheck: true,
  replaceTextWithEmojis: true,
  enterIsSend: false,

  loaded: false,

  loadSettings: async () => {
    try {
      const settings = await GetSettings()
      set({
        // Theme
        theme: settings.theme ?? "light",

        // Privacy Settings
        readReceipts: settings.readReceipts ?? true,
        blockUnknown: settings.blockUnknown ?? false,
        disableLinkPreviews: settings.disableLinkPreviews ?? false,

        // Notifications Settings
        messageNotifications: settings.messageNotifications ?? true,
        showPreviews: settings.showPreviews ?? true,
        showReactionNotifications: settings.showReactionNotifications ?? true,
        statusReactions: settings.statusReactions ?? true,
        callNotifications: settings.callNotifications ?? true,
        incomingCallSounds: settings.incomingCallSounds ?? true,
        incomingSounds: settings.incomingSounds ?? true,
        outgoingSounds: settings.outgoingSounds ?? true,

        // General Settings
        startAtLogin: settings.startAtLogin ?? false,
        minimizeToTray: settings.minimizeToTray ?? true,
        language: settings.language ?? "English",
        fontSize: settings.fontSize ?? "100% (Default)",

        // Chats Settings
        spellCheck: settings.spellCheck ?? true,
        replaceTextWithEmojis: settings.replaceTextWithEmojis ?? true,
        enterIsSend: settings.enterIsSend ?? false,

        loaded: true,
      })
    } catch (err) {
      console.error("Failed to load settings:", err)
      set({ loaded: true })
    }
  },

  updateSetting: async (key, value) => {
    set({ [key]: value })
    try {
      const current = get()
      await SaveSettings({
        // Theme
        theme: current.theme,

        // Privacy Settings
        readReceipts: current.readReceipts,
        blockUnknown: current.blockUnknown,
        disableLinkPreviews: current.disableLinkPreviews,

        // Notifications Settings
        messageNotifications: current.messageNotifications,
        showPreviews: current.showPreviews,
        showReactionNotifications: current.showReactionNotifications,
        statusReactions: current.statusReactions,
        callNotifications: current.callNotifications,
        incomingCallSounds: current.incomingCallSounds,
        incomingSounds: current.incomingSounds,
        outgoingSounds: current.outgoingSounds,

        // General Settings
        startAtLogin: current.startAtLogin,
        minimizeToTray: current.minimizeToTray,
        language: current.language,
        fontSize: current.fontSize,

        // Chats Settings
        spellCheck: current.spellCheck,
        replaceTextWithEmojis: current.replaceTextWithEmojis,
        enterIsSend: current.enterIsSend,
      })
    } catch (err) {
      console.error("Failed to save setting:", err)
    }
  },

  toggleTheme: async () => {
    const newTheme = get().theme === "light" ? "dark" : "light"
    await get().updateSetting("theme", newTheme)
  },
}))
