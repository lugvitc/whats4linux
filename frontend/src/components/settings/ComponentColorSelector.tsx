import { useEffect, useState } from "react"
import DropDown from "./DropDown"
import ToggleButton from "./ToggleButton"
import { SingleShortcut } from "../../screens/settingscreens/KeyBoardShortCuts"
import { MessagePreview } from "../chat/MessageItem"
import { THEME, applyThemeColors } from "../../theme.config"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"

type ThemeGroup = keyof typeof THEME
type ThemeLabel<G extends ThemeGroup> = keyof (typeof THEME)[G]

const isHex = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)

const ComponentColorSelector = () => {
  const { themeColors, updateThemeColor, theme } = useAppSettingsStore()
  const [selectedComponent, setSelectedComponent] = useState<ThemeGroup | null>(null)
  const [draft, setDraft] = useState<typeof themeColors | null>(null)

  useEffect(() => {
    if (selectedComponent) {
      setDraft(structuredClone({ ...THEME, ...themeColors }))
    } else {
      setDraft(null)
    }
  }, [selectedComponent, themeColors])

  useEffect(() => {
    if (draft) {
      applyThemeColors(draft)
    }

    return () => {
      applyThemeColors(themeColors)
    }
  }, [draft, themeColors])

  const handleDraftChange = (group: ThemeGroup, label: string, value: string) => {
    setDraft(prev => {
      if (!prev) return prev

      return {
        ...prev,
        [group]: {
          ...(prev[group] as Record<string, string>),
          [label]: value,
        },
      } as typeof prev
    })
  }

  const saveChanges = async () => {
    if (!selectedComponent || !draft) return

    const group = selectedComponent
    const groupData = draft[group] as Record<string, string>
    const labels = Object.keys(groupData) as Array<ThemeLabel<typeof group>>

    for (const label of labels) {
      const value = groupData[label as string]
      if (isHex(value)) {
        await updateThemeColor(group, label as string, value)
      }
    }
  }

  const resetToDefaults = () => {
    if (!selectedComponent) return
    const group = selectedComponent
    setDraft(prev => (prev ? { ...prev, [group]: { ...THEME[group] } } : prev))
  }

  return (
    <div className="flex flex-row gap-8 border p-6 rounded-xl w-full bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
      {/* LEFT: Selection */}
      <div className="flex flex-col justify-between w-1/3">
        <div>
          <h3 className="text-sm font-bold opacity-50 mb-4 uppercase tracking-wider">
            Customize Colors
          </h3>
          <DropDown
            title=""
            elements={Object.keys(THEME)}
            onToggle={val => setSelectedComponent(val as ThemeGroup)}
            placeholder="Select a component"
          />
        </div>

        {selectedComponent && (
          <div className="flex flex-col gap-2 mt-4">
            <button
              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-all"
              onClick={saveChanges}
            >
              Save Settings
            </button>
            <button
              className="w-full py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:opacity-80 transition-all text-sm"
              onClick={resetToDefaults}
            >
              Reset to Defaults
            </button>
          </div>
        )}
      </div>

      {/* MIDDLE: Editors */}
      <div className="flex flex-col gap-4 w-1/3 border-x border-zinc-100 dark:border-zinc-800 px-8">
        {!selectedComponent ? (
          <div className="h-full flex items-center justify-center opacity-40 text-sm">
            Pick a component to start editing
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="font-bold text-xl">{selectedComponent}</h2>
            <div className="space-y-4">
              {draft &&
                (
                  Object.keys(THEME[selectedComponent]) as Array<
                    keyof (typeof THEME)[typeof selectedComponent]
                  >
                )
                  .filter(label =>
                    theme === "dark"
                      ? String(label).includes("dark")
                      : !String(label).includes("dark"),
                  )
                  .sort()
                  .map(label => {
                    const value = (draft as any)[selectedComponent][label]
                    return (
                      <div key={label} className="flex flex-col gap-1">
                        <label className="text-md font-bold uppercase opacity-50">{label}</label>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              type="text"
                              value={value}
                              onChange={e =>
                                handleDraftChange(selectedComponent, label as any, e.target.value)
                              }
                              className="w-full border dark:border-zinc-700 rounded bg-transparent px-2 py-1.5 text-sm font-mono focus:outline-none"
                            />
                          </div>
                          <input
                            type="color"
                            value={isHex(value) ? value.slice(0, 7) : "#000000"}
                            onChange={e =>
                              handleDraftChange(selectedComponent, label as any, e.target.value)
                            }
                            className="w-10 h-8 rounded border-none cursor-pointer bg-transparent"
                          />
                        </div>
                      </div>
                    )
                  })}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Live Preview */}
      <div className="w-1/3 flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950/50 rounded-lg p-4">
        {!selectedComponent && (
          <span className="text-[10px] font-bold opacity-30 mb-4 uppercase tracking-widest">
            Live Preview
          </span>
        )}
        <div className="transform scale-110">
          {selectedComponent === "Keyboard Shortcut" && (
            <SingleShortcut name="Command" shortcut={["Ctrl", "P"]} />
          )}
          {selectedComponent === "Button" && (
            <>
              <ToggleButton isEnabled={true} onToggle={() => {}} />
              <ToggleButton isEnabled={false} onToggle={() => {}} />
            </>
          )}
          {selectedComponent === "DropDown" && (
            <DropDown elements={["Option 1", "Option 2"]} title="Preview" onToggle={() => {}} />
          )}
          {selectedComponent === "Chat Bubble" && <MessagePreview />}
        </div>
      </div>
    </div>
  )
}

export default ComponentColorSelector
