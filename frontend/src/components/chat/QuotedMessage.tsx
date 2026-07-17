import { useEffect, useState } from "react"
import { useContactStore } from "../../store/useContactStore"
import { isMe } from "../../lib/self"

export function QuotedMessage({
  contextInfo,
  onQuotedClick,
}: {
  contextInfo: any
  onQuotedClick?: (messageId: string) => void
}) {
  const [name, setName] = useState<string>("")
  const [senderColor, setSenderColor] = useState<string>("")
  const [loadingName, setLoadingName] = useState<boolean>(false)
  const getContactName = useContactStore(state => state.getContactName)
  const getContactColor = useContactStore(state => state.getContactColor)
  const quoted = contextInfo.quotedMessage
  // Quoting yourself shows "You" in green, like WhatsApp — no lookup needed.
  const isSelf = !!contextInfo.participant && isMe(contextInfo.participant)

  useEffect(() => {
    const participant = contextInfo.participant
    if (participant && !isSelf) {
      let mounted = true
      setLoadingName(true)
      getContactName(participant)
        .then((contactName: string) => {
          if (!mounted) return
          if (contactName) setName(contactName)
        })
        .catch(() => {})
        .finally(() => {
          if (!mounted) return
          setLoadingName(false)
        })
      getContactColor(participant)
        .then((color: string) => {
          if (!mounted) return
          if (color) setSenderColor(color)
        })
        .catch(() => {})

      return () => {
        mounted = false
      }
    }
  }, [contextInfo, isSelf, getContactName, getContactColor])

  if (!quoted) return null

  const getText = () => {
    if (quoted.extendedTextMessage?.text) return quoted.extendedTextMessage.text
    if (quoted.conversation) return quoted.conversation
    if (quoted.imageMessage) return quoted.imageMessage.caption || "📷 Photo"
    if (quoted.videoMessage) return quoted.videoMessage.caption || "🎥 Video"
    if (quoted.documentMessage) return quoted.documentMessage.fileName || "📄 Document"
    if (quoted.audioMessage) return "🎵 Audio"
    if (quoted.stickerMessage) return "Sticker"
    return "Message"
  }

  const handleClick = () => {
    const stanzaId = contextInfo.stanzaId
    if (stanzaId && onQuotedClick) {
      onQuotedClick(stanzaId)
    }
  }

  const accentColor = isSelf || !senderColor ? "#21c063" : senderColor

  return (
    <div
      className="bg-black/5 dark:bg-black/25 rounded-lg p-2 mb-1.5 border-l-4 text-xs cursor-pointer hover:bg-black/10 dark:hover:bg-black/35 transition-colors"
      style={{ borderLeftColor: accentColor }}
      onClick={handleClick}
    >
      {/* Reserve a fixed-height area for the name so the quoted message height doesn't jump when name resolves */}
      <div className="mb-1 h-4 flex items-center overflow-hidden">
        {loadingName ? (
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-green-600 border-t-transparent animate-spin" />
            <span className="h-3 rounded bg-black/10 dark:bg-white/10 w-20" />
          </div>
        ) : (
          <div className="font-medium truncate" style={{ color: accentColor }}>
            {isSelf ? "You" : name}
          </div>
        )}
      </div>

      <div
        className="line-clamp-2 text-gray-600 dark:text-gray-300"
        dangerouslySetInnerHTML={{ __html: getText() }}
      ></div>
    </div>
  )
}
