import { useState, useEffect, useRef } from "react"
import { store } from "../../../wailsjs/go/models"
import { GetCachedImage, DownloadMedia, GetVideoThumbnail } from "../../../wailsjs/go/api/Api"
import { useUIStore } from "../../store"

// TODO: fix word wrap for longer words in content

// GIFs (WhatsApp sends them as short muted videos) loop a few times then stop.
const MAX_GIF_LOOPS = 3

interface MediaContentProps {
  message: store.DecodedMessage
  type: "image" | "video" | "sticker" | "audio" | "document"
  chatId: string
  isGif?: boolean
  sentMediaCache?: React.MutableRefObject<Map<string, string>>
  onImageClick?: (src: string) => void
  onDownload?: () => void
}

export function MediaContent({
  message,
  type,
  chatId,
  isGif,
  sentMediaCache,
  onImageClick,
  onDownload,
}: MediaContentProps) {
  const [mediaSrc, setMediaSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showDownloadButton, setShowDownloadButton] = useState(false)
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)
  const gifLoopsRef = useRef(0)
  const placeholderRef = useRef<HTMLDivElement | null>(null)
  const openLightbox = useUIStore(s => s.openLightbox)

  const loadFromCache = async (): Promise<string | null> => {
    if (loading) return null
    setLoading(true)
    try {
      const imagePath = await GetCachedImage(message.Info.ID)
      if (imagePath) setMediaSrc(imagePath)
      return imagePath || null
    } catch (e) {
      return null
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (loading) return
    setLoading(true)
    try {
      // DownloadMedia returns a ready-to-use data URL with the correct MIME.
      const dataUrl = await DownloadMedia(chatId, message.Info.ID)
      setMediaSrc(dataUrl)
    } catch (e) {
    } finally {
      setLoading(false)
    }
  }

  // Regular videos play full-screen in the lightbox (keeps the chat thumbnail).
  // The downloaded data URL is cached in a ref so reopening doesn't re-download.
  const videoDataRef = useRef<string>("")
  const openVideo = async () => {
    if (videoDataRef.current) {
      openLightbox(videoDataRef.current, "video")
      return
    }
    if (loading) return
    setLoading(true)
    try {
      const dataUrl = await DownloadMedia(chatId, message.Info.ID)
      videoDataRef.current = dataUrl
      openLightbox(dataUrl, "video")
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
      return
    }
    if (messageBody?._tempFile) {
      const blobUrl = URL.createObjectURL(messageBody._tempFile)
      setMediaSrc(blobUrl)
      return
    }
    if (sentMediaCache?.current.has(message.Info.ID)) {
      setMediaSrc(sentMediaCache.current.get(message.Info.ID)!)
      return
    }
    if (type === "image" || type === "sticker") {
      // Show instantly if cached; otherwise the IntersectionObserver below
      // fetches it once it's actually on screen.
      loadFromCache()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.Info.ID, type])

  // Auto-download image/sticker media once it's visible on screen — covers both
  // "already visible when the chat opens" and "scrolled into view". Debounced so
  // rows blazed past during a fast scroll don't fetch.
  useEffect(() => {
    const autoLoads = type === "image" || type === "sticker" || (type === "video" && isGif)
    if (mediaSrc || !autoLoads) return
    const el = placeholderRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => handleDownload(), 200)
        } else if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
      },
      { rootMargin: "150px", threshold: 0.01 },
    )
    obs.observe(el)
    return () => {
      obs.disconnect()
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSrc, type, isGif, message.Info.ID])

  // Fetch the embedded preview for regular videos so the list shows a thumbnail
  // + play button without downloading the whole video. (GIFs auto-play instead.)
  useEffect(() => {
    if (type !== "video" || isGif || mediaSrc) return
    let cancelled = false
    GetVideoThumbnail(message.Info.ID)
      .then(url => {
        if (!cancelled && url) setThumbnailSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [type, isGif, mediaSrc, message.Info.ID])

  useEffect(() => {
    // Cleanup blob URLs when component unmounts or mediaSrc changes
    return () => {
      if (mediaSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(mediaSrc)
      }
    }
  }, [mediaSrc])


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
            onClick={
              type === "image"
                ? () => {
                    onImageClick?.(mediaSrc)
                    openLightbox(mediaSrc)
                  }
                : undefined
            }
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
    if (type === "video")
      return isGif ? (
        <video
          src={mediaSrc}
          autoPlay
          muted
          playsInline
          onEnded={e => {
            if (gifLoopsRef.current < MAX_GIF_LOOPS - 1) {
              gifLoopsRef.current += 1
              const v = e.currentTarget
              v.currentTime = 0
              void v.play().catch(() => {})
            }
          }}
          onClick={e => {
            // Replay from the start when clicked, even after it has stopped.
            const v = e.currentTarget
            gifLoopsRef.current = 0
            v.currentTime = 0
            void v.play().catch(() => {})
          }}
          className="block min-w-75 max-w-82.5 max-h-100 rounded-lg cursor-pointer"
        />
      ) : (
        <video src={mediaSrc} controls className="block min-w-75 max-w-82.5 max-h-100 rounded-lg" />
      )
    if (type === "audio") return <audio src={mediaSrc} controls className="w-full" />
  }

  // Video placeholder: show the embedded thumbnail (if any) with a play button
  // so it's clearly a video, and only download the full file on click.
  if (type === "video") {
    return (
      <div
        ref={placeholderRef}
        onClick={openVideo}
        className="relative w-64 h-64 rounded-lg overflow-hidden bg-gray-300 dark:bg-gray-800 flex items-center justify-center cursor-pointer bg-cover bg-center"
        style={thumbnailSrc ? { backgroundImage: `url(${thumbnailSrc})` } : undefined}
      >
        {loading ? (
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
        ) : (
          <div className="bg-black/55 rounded-full p-3">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={placeholderRef}
      className="w-64 h-64 bg-gray-200 dark:bg-gray-800 rounded-lg flex items-center justify-center"
    >
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
