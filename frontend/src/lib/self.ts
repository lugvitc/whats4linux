import { GetMyJID } from "../../wailsjs/go/api/Api"

let myUser = ""

// The phone-number part of a JID, ignoring device and server suffixes.
export function userPart(jid: string): string {
  return (jid || "").split("@")[0].split(":")[0]
}

export async function initSelf() {
  try {
    myUser = userPart(await GetMyJID())
  } catch {
    /* not logged in yet */
  }
}

// Whether a reaction sender is us ("me" is the optimistic local marker).
export function isMe(senderId: string): boolean {
  if (!senderId) return false
  if (senderId === "me") return true
  return !!myUser && userPart(senderId) === myUser
}
