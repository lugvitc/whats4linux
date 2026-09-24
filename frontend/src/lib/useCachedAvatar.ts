import { useEffect, useState } from "react"
import { GetCachedAvatar } from "../../wailsjs/go/api/Api"

/** Loads a contact's cached avatar once, cancelling stale lookups on unmount. */
export function useCachedAvatar(jid: string): string | null {
  const [avatar, setAvatar] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    GetCachedAvatar(jid, false)
      .then(url => {
        if (live) setAvatar(url || null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [jid])

  return avatar
}
