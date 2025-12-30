interface Shortcut {
  name: string
  shortcut: string[]
}

const shortcuts: Shortcut[] = [
  { name: "Lock app", shortcut: ["Alt", "L"] },
  { name: "Open chat info", shortcut: ["Alt", "I"] },
  { name: "Block chat", shortcut: ["Ctrl", "Shift", "B"] },
  { name: "Reply", shortcut: ["Alt", "R"] },
  { name: "Reply privately", shortcut: ["Ctrl", "Alt", "R"] },
  { name: "Forward", shortcut: ["Ctrl", "Alt", "D"] },
  { name: "Star message", shortcut: ["Alt", "8"] },
  { name: "Open attachment dropdown", shortcut: ["Alt", "A"] },
  { name: "Start PTT recording", shortcut: ["Ctrl", "Alt", "Shift", "R"] },
  { name: "Pause PTT recording", shortcut: ["Alt", "P"] },
  { name: "Send PTT", shortcut: ["Ctrl", "Enter"] },
  { name: "Edit last message", shortcut: ["Ctrl", "ArrowUp"] },
  { name: "Zoom in", shortcut: ["Ctrl", "+"] },
  { name: "Zoom out", shortcut: ["Ctrl", "-"] },
  { name: "Zoom reset", shortcut: ["Ctrl", "0"] },
  { name: "Open chat", shortcut: ["Ctrl", "1..9"] },
  { name: "Mark as unread", shortcut: ["Ctrl", "Shift", "U"] },
  { name: "Mute", shortcut: ["Ctrl", "Shift", "M"] },
  { name: "Archive chat", shortcut: ["Ctrl", "Shift", "A"] },
  { name: "Pin chat", shortcut: ["Ctrl", "Alt", "Shift", "P"] },
  { name: "Search", shortcut: ["Ctrl", "Alt", "/"] },
  { name: "Search chat", shortcut: ["Ctrl", "Shift", "F"] },
  { name: "New chat", shortcut: ["Ctrl", "Alt", "N"] },
  { name: "Next chat", shortcut: ["Ctrl", "]"] },
  { name: "Previous chat", shortcut: ["Ctrl", "["] },
  { name: "Label chat", shortcut: ["Ctrl", "Cmd", "Shift", "L"] },
  { name: "Close chat", shortcut: ["Escape"] },
  { name: "New group", shortcut: ["Ctrl", "Shift", "N"] },
  { name: "Profile and About", shortcut: ["Ctrl", "Alt", "P"] },
  { name: "Increase speed of selected voice message", shortcut: ["Shift", "."] },
  { name: "Decrease speed of selected voice message", shortcut: ["Shift", ","] },
  { name: "Settings", shortcut: ["Alt", "S"] },
  { name: "Emoji panel", shortcut: ["Ctrl", "Alt", "E"] },
  { name: "GIF panel", shortcut: ["Ctrl", "Alt", "G"] },
  { name: "Sticker panel", shortcut: ["Ctrl", "Alt", "S"] },
  { name: "Extended search", shortcut: ["Alt", "K"] },
]

const SingleShortcut = ({ name, shortcut }: Shortcut) => {
  return (
    <div className="flex flex-row gap-2 justify-between">
      <div className="text-white text-xl">{name}</div>
      <div className="flex flex-row gap-1">
        {shortcut.map((key, index) => (
          <div
            key={index}
            className="bg-shortcut-bg text-shortcut-text border border-shortcut-border rounded-xl px-2 py-1 w-fit"
          >
            {key}
          </div>
        ))}
      </div>
    </div>
  )
}

const KeyBoardShortCuts = () => {
  return (
    <div className="flex flex-col gap-2">
      {shortcuts.map((sc, index) => (
        <SingleShortcut key={index} name={sc.name} shortcut={sc.shortcut} />
      ))}
    </div>
  )
}

export default KeyBoardShortCuts
