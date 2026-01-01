import { useState, useEffect } from "react"
import { store } from "../../../wailsjs/go/models"
import { DownloadMedia } from "../../../wailsjs/go/api/Api"

interface MediaContentProps {
  message: store.Message
  type: "image" | "video" | "sticker" | "audio" | "document"
  chatId: string
  sentMediaCache?: React.MutableRefObject<Map<string, string>>
}

export function MediaContent({ message, type, chatId, sentMediaCache }: MediaContentProps) {
  const [mediaSrc, setMediaSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const content = message.Content as any
    const messageBody = content?.[`${type}Message`]

    // Check for Optimistic (Temporary) Media
    if (messageBody?._tempImage) {
      setMediaSrc(messageBody._tempImage)
    } else if (messageBody?._tempFile) {
      const url = URL.createObjectURL(messageBody._tempFile)
      setMediaSrc(url)
    } else if (sentMediaCache?.current.has(message.Info.ID)) {
      setMediaSrc(sentMediaCache.current.get(message.Info.ID)!)
    }

    // Auto-download stickers
    if (type === "sticker") handleDownload()
  }, [message.Info.ID])

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (mediaSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(mediaSrc)
      }
    }
  }, [mediaSrc])

  const handleDownload = async () => {
    if (mediaSrc || loading) return
    setLoading(true)
    try {
      const data = await DownloadMedia(chatId, message.Info.ID)
      const mime =
        (message.Content as any)?.[`${type}Message`]?.mimetype || "application/octet-stream"
      setMediaSrc(`data:${mime};base64,${data}`)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (mediaSrc) {
    if (type === "image" || type === "sticker") {
      return (
        <img
          src={mediaSrc}
          className={type === "image" ? "max-w-full rounded-lg" : "object-contain w-48.75 h-48.75"}
          alt="media"
        />
      )
    }
    if (type === "video") return <video src={mediaSrc} controls className="max-w-full rounded-lg" />
    if (type === "audio") return <audio src={mediaSrc} controls className="w-full" />
  }

  return (
    <div className="w-64 h-64 bg-gray-200 dark:bg-gray-800 rounded-lg flex items-center justify-center relative">
      {loading ? (
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      ) : (
        <button
          onClick={handleDownload}
          className="bg-black/50 p-3 rounded-full text-white hover:bg-black/70"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          </svg>
        </button>
      )}
    </div>
  )
}
