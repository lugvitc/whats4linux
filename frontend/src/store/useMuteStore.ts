import { create } from "zustand"

interface MuteStore {
  mutedJids: Set<string>
  setMuted: (jid: string, muted: boolean) => void
  hydrate: (jids: string[]) => void
}

/**
 * Pure helper: returns a new Set with the jid added or removed.
 * Returns the same Set instance when nothing changes so zustand
 * subscribers don't re-render needlessly.
 */
export function applyMuted(current: Set<string>, jid: string, muted: boolean): Set<string> {
  if (!jid) return current
  if (muted === current.has(jid)) return current

  const next = new Set(current)
  if (muted) {
    next.add(jid)
  } else {
    next.delete(jid)
  }
  return next
}

/** Pure helper: builds a muted-set from a list of jids (empty/duplicate safe). */
export function buildMutedSet(jids: string[]): Set<string> {
  return new Set((jids ?? []).filter(jid => typeof jid === "string" && jid.length > 0))
}

export const useMuteStore = create<MuteStore>(set => ({
  mutedJids: new Set<string>(),

  setMuted: (jid, muted) =>
    set(state => {
      const next = applyMuted(state.mutedJids, jid, muted)
      return next === state.mutedJids ? state : { mutedJids: next }
    }),

  hydrate: jids => set({ mutedJids: buildMutedSet(jids) }),
}))

/** Subscribe to the muted flag of a single chat. */
export const useChatMuted = (jid: string): boolean =>
  useMuteStore(state => state.mutedJids.has(jid))
