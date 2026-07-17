import { useEffect, useState } from "react"
import { SendPoll } from "../../../wailsjs/go/api/Api"

const MAX_OPTIONS = 12

export function PollDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [question, setQuestion] = useState("")
  const [options, setOptions] = useState<string[]>(["", ""])
  const [multiple, setMultiple] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  // Close on ESC in the capture phase so the chat's own ESC handler
  // (which closes the whole chat) never sees the event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  const setOption = (i: number, v: string) =>
    setOptions(prev => prev.map((o, idx) => (idx === i ? v : o)))

  const removeOption = (i: number) =>
    setOptions(prev => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))

  const valid = question.trim() !== "" && options.filter(o => o.trim() !== "").length >= 2

  const send = async () => {
    if (!valid || sending) return
    setSending(true)
    setError("")
    try {
      await SendPoll(
        chatId,
        question.trim(),
        options.map(o => o.trim()).filter(Boolean),
        multiple ? 0 : 1,
      )
      onClose()
    } catch (err) {
      console.error("Failed to send poll:", err)
      setError(String(err))
      setSending(false)
    }
  }

  const inputCls =
    "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none " +
    "focus:border-[#21c063] dark:border-white/10 dark:focus:border-[#21c063] " +
    "text-light-text dark:text-dark-text placeholder-gray-500"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] rounded-xl bg-white p-4 shadow-xl dark:bg-dark-secondary"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-medium text-light-text dark:text-dark-text">
          Create poll
        </h2>

        <input
          autoFocus
          className={inputCls}
          placeholder="Ask a question"
          value={question}
          onChange={e => setQuestion(e.target.value)}
        />

        <div className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={inputCls}
                placeholder={`Option ${i + 1}`}
                value={opt}
                onChange={e => setOption(i, e.target.value)}
              />
              {options.length > 2 && (
                <button
                  onClick={() => removeOption(i)}
                  className="shrink-0 text-gray-400 hover:text-red-500"
                  title="Remove option"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < MAX_OPTIONS && (
          <button
            onClick={() => setOptions(prev => [...prev, ""])}
            className="mt-2 text-sm text-[#1b9a58] hover:underline dark:text-[#21c063]"
          >
            + Add option
          </button>
        )}

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={multiple}
            onChange={e => setMultiple(e.target.checked)}
            className="accent-[#21c063]"
          />
          Allow multiple answers
        </label>

        {error && <div className="mt-2 text-xs text-red-500">{error}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={!valid || sending}
            className="rounded-lg bg-[#21c063] px-4 py-2 text-sm font-medium text-[#0a1014] disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send poll"}
          </button>
        </div>
      </div>
    </div>
  )
}
