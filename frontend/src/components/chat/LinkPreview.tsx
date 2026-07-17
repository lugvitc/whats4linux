import { useEffect, useState } from "react"
import { GetLinkPreview, GetLinkPreviewImage } from "../../../wailsjs/go/api/Api"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"

interface Preview {
  url: string
  title: string
  description: string
  thumbnail: string
}

// Module-level caches: Virtuoso remounts rows on every scroll pass, and an
// async preview popping in after mount grows the row and makes the whole list
// jump mid-scroll. After the first fetch (including "no preview" = null) the
// card renders synchronously and the row height is stable forever.
const previewCache = new Map<string, Preview | null>()
const posterCache = new Map<string, string>()

// Renders the WhatsApp link-preview card under a message, if one was stored.
export function LinkPreview({ messageId }: { messageId: string }) {
  const [preview, setPreview] = useState<Preview | null>(
    () => previewCache.get(messageId) ?? null,
  )
  const [poster, setPoster] = useState<string>(() => posterCache.get(messageId) ?? "")

  useEffect(() => {
    if (previewCache.has(messageId)) return
    let cancelled = false
    GetLinkPreview(messageId)
      .then(p => {
        if (!p || (!p.title && !p.thumbnail)) {
          previewCache.set(messageId, null)
          return
        }
        previewCache.set(messageId, p as Preview)
        if (!cancelled) setPreview(p as Preview)
        // The poster is usually a downloadable reference, not embedded — fetch
        // it lazily (downloaded + cached on first request).
        if (!p.thumbnail) {
          GetLinkPreviewImage(messageId)
            .then(url => {
              if (!url) return
              posterCache.set(messageId, url)
              if (!cancelled) setPoster(url)
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [messageId])

  if (!preview) return null

  const image = preview.thumbnail || poster

  let domain = ""
  try {
    domain = new URL(preview.url).hostname.replace(/^www\./, "")
  } catch {
    /* ignore malformed URL */
  }

  return (
    <div
      onClick={() => preview.url && BrowserOpenURL(preview.url)}
      className="mt-1 max-w-72 overflow-hidden rounded-lg bg-black/10 dark:bg-black/25 cursor-pointer"
    >
      {/* Fixed height: an unconstrained image resizes the card (and the row)
          when it decodes, which shakes the virtualized list. */}
      {image && <img src={image} alt="" className="w-full h-40 object-cover bg-black/20" />}
      <div className="p-2">
        {preview.title && (
          <div className="text-sm font-medium line-clamp-2 leading-snug">{preview.title}</div>
        )}
        {preview.description && (
          <div className="mt-0.5 text-xs opacity-70 line-clamp-2">{preview.description}</div>
        )}
        {domain && (
          <div className="mt-1 text-[10px] uppercase tracking-wide opacity-50">{domain}</div>
        )}
      </div>
    </div>
  )
}
