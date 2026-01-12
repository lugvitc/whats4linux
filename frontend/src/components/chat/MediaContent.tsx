import { useState, useEffect } from "react"
import { store } from "../../../wailsjs/go/models"
import { GetCachedImage, DownloadMedia } from "../../../wailsjs/go/api/Api"

// TODO: fix word wrap for longer words in content

interface MediaContentProps {
  message: store.DecodedMessage
  type: "image" | "video" | "sticker" | "audio" | "document"
  chatId: string
  sentMediaCache?: React.MutableRefObject<Map<string, string>>
  onImageClick?: (src: string) => void
  onDownload?: () => void
}

export function MediaContent({
  message,
  type,
  chatId,
  sentMediaCache,
  onImageClick,
  onDownload,
}: MediaContentProps) {
  const [mediaSrc, setMediaSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showDownloadButton, setShowDownloadButton] = useState(false)

  const loadFromCache = async () => {
    if (loading) return
    setLoading(true)
    try {
      const imagePath = await GetCachedImage(message.Info.ID)
      if (imagePath) {
        setMediaSrc(imagePath)
      }
    } catch (e) {
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const content = message.Content as any
    const messageBody = content?.[`${type}Message`]

    if (messageBody?._tempImage) {
      setMediaSrc(messageBody._tempImage)
    } else if (messageBody?._tempFile) {
      const blobUrl = URL.createObjectURL(messageBody._tempFile)
      setMediaSrc(blobUrl)
    } else if (sentMediaCache?.current.has(message.Info.ID)) {
      setMediaSrc(sentMediaCache.current.get(message.Info.ID)!)
    } else if (type === "image" || type === "sticker") {
      loadFromCache()
    }
  }, [message.Info.ID, type])

  useEffect(() => {
    // Cleanup blob URLs when component unmounts or mediaSrc changes
    return () => {
      if (mediaSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(mediaSrc)
      }
    }
  }, [mediaSrc])

  const handleDownload = async () => {
    if (loading) return
    setLoading(true)
    try {
      const data = await DownloadMedia(chatId, message.Info.ID)
      setMediaSrc(
        `data:${(message.Content as any)?.[`${type}Message`]?.mimetype || "application/octet-stream"};base64,${data}`,
      )
    } catch (e) {
    } finally {
      setLoading(false)
    }
  }

  if (mediaSrc) {
    if (type === "image" || type === "sticker") {
      return (
        <div
          className="relative inline-block"
          onMouseEnter={() => type === "image" && setShowDownloadButton(true)}
          onMouseLeave={() => setShowDownloadButton(false)}
        >
          <img
            src={mediaSrc}
            className={
              type === "image"
                ? "block min-w-75 max-w-82.5 max-h-100 object-cover rounded-lg cursor-pointer"
                : "object-contain w-48.75 h-48.75"
            }
            alt="media"
            onClick={type === "image" && onImageClick ? () => onImageClick(mediaSrc) : undefined}
          />
          {type === "image" && showDownloadButton && onDownload && (
            <button
              onClick={e => {
                e.stopPropagation()
                onDownload()
              }}
              className="absolute top-2 right-2 p-2 bg-black/70 hover:bg-black/90 rounded-full text-white transition-colors"
              title="Download image"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
              </svg>
            </button>
          )}
        </div>
      )
    }
    if (type === "video") return <video src={mediaSrc} controls className="max-w-full rounded-lg" />
    if (type === "audio") return <audio src={mediaSrc} controls className="w-full" />
  }

  return (
    <div className="w-64 h-64 bg-gray-200 dark:bg-gray-800 rounded-lg flex items-center justify-center">
      {loading ? (
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      ) : (
        <button
          onClick={type === "video" || type === "audio" ? handleDownload : loadFromCache}
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
