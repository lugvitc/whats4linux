export const THEME = {
  DropDown: {
    "dropdown text": "#000000",
    "dropdown dark text": "#ffffff",

    "dropdown bg": "#ffffff",
    "dropdown dark bg": "#0d0d0d",

    "dropdown hover bg": "#f5f5f5",
    "dropdown dark hover bg": "#3a3a3a",

    "dropdown element text": "#000000",
    "dropdown element dark text": "#ffffff",

    "dropdown element bg": "#ffffff",
    "dropdown element dark bg": "#0d0d0d",

    "dropdown element hover bg": "#f5f5f5",
    "dropdown element dark hover bg": "#3a3a3a",

    "dropdown border": "#dcdcdc50",
    "dropdown dark border": "#dcdcdc50",
  },

  Button: {
    "toggle bg": "#21c063",
    "toggle dark bg": "#21c063",

    "toggle closed": "#4a5565",
    "toggle dark closed": "#4a5565",

    "toggle circle": "#000000",
    "toggle dark circle": "#ffffff",
  },

  "Keyboard Shortcut": {
    "shortcut bg": "#ffffff",
    "shortcut dark bg": "#323232",
    "shortcut border": "#585a5c",
    "shortcut text": "#000000",
    "shortcut dark text": "#ffffff",
  },

  "Chat Bubble": {
    "sent bubble bg": "#d9fdd3",
    "sent bubble dark bg": "#005c4b",
    "sent bubble text": "#101828",
    "sent bubble dark text": "#ffffff",
    "received bubble bg": "#ffffff",
    "received bubble dark bg": "#202c33",
    "received bubble text": "#101828",
    "received bubble dark text": "#ffffff",
  },
} as const

const toCssVar = (label: string) => `--color-${label.replace(/\s+/g, "-")}`

export const applyThemeColors = (colors = THEME) => {
  Object.values(colors).forEach(group => {
    Object.entries(group).forEach(([label, value]) => {
      document.documentElement.style.setProperty(toCssVar(label), value)
    })
  })
}

export const DEFAULT_EASES = {
  DropDown: {
    open: "power2.out",
    close: "power2.in",
    rotate: "power2.out",
  },
  ToggleButton: {
    slide: "elastic.out(1, 0.5)",
  },
} as const
