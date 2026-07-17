import { useEffect, useMemo, useState } from "react"
import { FetchContacts, SendShareContact } from "../../../wailsjs/go/api/Api"
import { api } from "../../../wailsjs/go/models"

export function ContactShareDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [contacts, setContacts] = useState<api.Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [sendingJid, setSendingJid] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    FetchContacts()
      .then(list => {
        if (cancelled) return
        const sorted = (list || []).sort((a, b) =>
          (a.full_name || a.push_name || a.phno).localeCompare(
            b.full_name || b.push_name || b.phno,
          ),
        )
        setContacts(sorted)
      })
      .catch(err => {
        console.error("Failed to load contacts:", err)
        setError("Failed to load contacts")
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  // Capture-phase ESC so the chat's own ESC handler doesn't fire too.
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

  const filtered = useMemo(() => {
    const term = search.toLowerCase()
    if (!term) return contacts
    return contacts.filter(c => (c.full_name || c.push_name || c.phno).toLowerCase().includes(term))
  }, [contacts, search])

  const share = async (c: api.Contact) => {
    if (sendingJid) return
    const name = c.full_name || c.push_name || c.phno
    setSendingJid(c.jid)
    setError("")
    try {
      await SendShareContact(chatId, name, c.phno)
      onClose()
    } catch (err) {
      console.error("Failed to share contact:", err)
      setError(String(err))
      setSendingJid("")
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-[420px] max-w-[90vw] flex-col rounded-xl bg-white p-4 shadow-xl dark:bg-dark-secondary"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-medium text-light-text dark:text-dark-text">
          Share contact
        </h2>

        <input
          autoFocus
          className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-[#21c063] dark:border-white/10 dark:focus:border-[#21c063] text-light-text dark:text-dark-text placeholder-gray-500"
          placeholder="Search contacts"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {error && <div className="mt-2 text-xs text-red-500">{error}</div>}

        <div className="mt-3 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#21c063] border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500 dark:text-[#8696a0]">
              No contacts found
            </div>
          ) : (
            filtered.map(c => (
              <button
                key={c.jid}
                onClick={() => share(c)}
                disabled={!!sendingJid}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-white/5"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm text-light-text dark:text-dark-text">
                    {c.full_name || c.push_name || c.phno}
                  </div>
                  <div className="truncate text-xs text-gray-500 dark:text-[#8696a0]">{c.phno}</div>
                </div>
                {sendingJid === c.jid && (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#21c063] border-t-transparent" />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
