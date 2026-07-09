import { useEffect, useState } from "react"
import clsx from "clsx"
import { useUIStore } from "../store"

// Full-screen image viewer. Click the backdrop or × or Esc to close; click the
// image to toggle zoom.
export function Lightbox() {
  const src = useUIStore(s => s.lightboxSrc)
  const kind = useUIStore(s => s.lightboxKind)
  const close = useUIStore(s => s.closeLightbox)
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    if (!src) return
    setZoomed(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [src, close])

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-auto bg-black/90"
      onClick={close}
    >
      <button
        onClick={close}
        title="Close (Esc)"
        className="absolute right-4 top-3 text-3xl leading-none text-white/80 hover:text-white"
      >
        ×
      </button>
      {kind === "video" ? (
        <video
          src={src}
          controls
          autoPlay
          controlsList="nofullscreen"
          disablePictureInPicture
          onClick={e => e.stopPropagation()}
          className="h-[95vh] w-[95vw] object-contain"
        />
      ) : (
        <img
          src={src}
          alt=""
          onClick={e => {
            e.stopPropagation()
            setZoomed(z => !z)
          }}
          className={clsx(
            "select-none transition-transform",
            zoomed
              ? "max-h-none max-w-none scale-150 cursor-zoom-out"
              : "max-h-[92vh] max-w-[92vw] cursor-zoom-in object-contain",
          )}
        />
      )}
    </div>
  )
}
