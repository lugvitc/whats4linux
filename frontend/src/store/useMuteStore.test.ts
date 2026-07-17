import { describe, it, expect, beforeEach } from "vitest"
import { useMuteStore, applyMuted, buildMutedSet } from "./useMuteStore"

const JID_A = "1111111111@s.whatsapp.net"
const JID_B = "120363404754523806@g.us"

describe("applyMuted", () => {
  it("adds a jid when muting", () => {
    const next = applyMuted(new Set(), JID_A, true)
    expect(next.has(JID_A)).toBe(true)
    expect(next.size).toBe(1)
  })

  it("removes a jid when unmuting", () => {
    const next = applyMuted(new Set([JID_A, JID_B]), JID_A, false)
    expect(next.has(JID_A)).toBe(false)
    expect(next.has(JID_B)).toBe(true)
  })

  it("does not mutate the input set", () => {
    const original = new Set([JID_A])
    applyMuted(original, JID_B, true)
    applyMuted(original, JID_A, false)
    expect(original.size).toBe(1)
    expect(original.has(JID_A)).toBe(true)
  })

  it("returns a new instance when membership changes", () => {
    const original = new Set<string>()
    const next = applyMuted(original, JID_A, true)
    expect(next).not.toBe(original)
  })

  it("returns the same instance when muting an already-muted jid", () => {
    const original = new Set([JID_A])
    expect(applyMuted(original, JID_A, true)).toBe(original)
  })

  it("returns the same instance when unmuting an unknown jid", () => {
    const original = new Set([JID_A])
    expect(applyMuted(original, JID_B, false)).toBe(original)
  })

  it("ignores empty jids", () => {
    const original = new Set([JID_A])
    expect(applyMuted(original, "", true)).toBe(original)
    expect(applyMuted(original, "", false)).toBe(original)
  })
})

describe("buildMutedSet", () => {
  it("builds a set from a jid list", () => {
    const set = buildMutedSet([JID_A, JID_B])
    expect(set.has(JID_A)).toBe(true)
    expect(set.has(JID_B)).toBe(true)
    expect(set.size).toBe(2)
  })

  it("deduplicates jids", () => {
    expect(buildMutedSet([JID_A, JID_A, JID_A]).size).toBe(1)
  })

  it("drops empty and non-string entries", () => {
    const set = buildMutedSet(["", JID_A, null as unknown as string, 42 as unknown as string])
    expect(set.size).toBe(1)
    expect(set.has(JID_A)).toBe(true)
  })

  it("handles an empty list", () => {
    expect(buildMutedSet([]).size).toBe(0)
  })

  it("handles null/undefined input defensively", () => {
    expect(buildMutedSet(null as unknown as string[]).size).toBe(0)
    expect(buildMutedSet(undefined as unknown as string[]).size).toBe(0)
  })
})

describe("useMuteStore", () => {
  beforeEach(() => {
    useMuteStore.setState({ mutedJids: new Set<string>() })
  })

  it("starts empty", () => {
    expect(useMuteStore.getState().mutedJids.size).toBe(0)
  })

  it("setMuted(jid, true) marks a chat muted", () => {
    useMuteStore.getState().setMuted(JID_A, true)
    expect(useMuteStore.getState().mutedJids.has(JID_A)).toBe(true)
  })

  it("setMuted(jid, false) unmutes a chat", () => {
    useMuteStore.getState().setMuted(JID_A, true)
    useMuteStore.getState().setMuted(JID_A, false)
    expect(useMuteStore.getState().mutedJids.has(JID_A)).toBe(false)
  })

  it("tracks multiple chats independently", () => {
    useMuteStore.getState().setMuted(JID_A, true)
    useMuteStore.getState().setMuted(JID_B, true)
    useMuteStore.getState().setMuted(JID_A, false)
    const { mutedJids } = useMuteStore.getState()
    expect(mutedJids.has(JID_A)).toBe(false)
    expect(mutedJids.has(JID_B)).toBe(true)
  })

  it("no-op updates keep the same Set reference (no spurious re-renders)", () => {
    useMuteStore.getState().setMuted(JID_A, true)
    const before = useMuteStore.getState().mutedJids
    useMuteStore.getState().setMuted(JID_A, true)
    useMuteStore.getState().setMuted(JID_B, false)
    useMuteStore.getState().setMuted("", true)
    expect(useMuteStore.getState().mutedJids).toBe(before)
  })

  it("replaces the Set reference on real changes", () => {
    const before = useMuteStore.getState().mutedJids
    useMuteStore.getState().setMuted(JID_A, true)
    expect(useMuteStore.getState().mutedJids).not.toBe(before)
  })

  it("hydrate replaces the full muted set", () => {
    useMuteStore.getState().setMuted(JID_A, true)
    useMuteStore.getState().hydrate([JID_B])
    const { mutedJids } = useMuteStore.getState()
    expect(mutedJids.has(JID_A)).toBe(false)
    expect(mutedJids.has(JID_B)).toBe(true)
    expect(mutedJids.size).toBe(1)
  })

  it("hydrate with an empty list clears the set", () => {
    useMuteStore.getState().setMuted(JID_A, true)
    useMuteStore.getState().hydrate([])
    expect(useMuteStore.getState().mutedJids.size).toBe(0)
  })

  it("notifies subscribers on change", () => {
    let calls = 0
    const unsub = useMuteStore.subscribe(() => {
      calls++
    })
    useMuteStore.getState().setMuted(JID_A, true)
    expect(calls).toBe(1)
    unsub()
  })
})
