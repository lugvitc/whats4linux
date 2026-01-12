import { useEffect, useState } from "react"
import { parseWhatsAppMarkdown } from "../../utils/markdown"
import { useContactStore } from "../../store/useContactStore"

export function QuotedMessage({
  contextInfo,
  onQuotedClick,
}: {
  contextInfo: any
  onQuotedClick?: (messageId: string) => void
}) {
  const [name, setName] = useState<string>("")
  const [loadingName, setLoadingName] = useState<boolean>(false)
  const getContactName = useContactStore(state => state.getContactName)
  const quoted = contextInfo.quotedMessage || contextInfo.QuotedMessage

  useEffect(() => {
    const participant = contextInfo.participant || contextInfo.Participant
    if (participant) {
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

      return () => {
        mounted = false
      }
    }
  }, [contextInfo, getContactName])

  if (!quoted) return null

  const getText = () => {
    if (quoted.extendedTextMessage?.text)
      return parseWhatsAppMarkdown(quoted.extendedTextMessage.text)
    if (quoted.conversation) return parseWhatsAppMarkdown(quoted.conversation)
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

  return (
    <div
      className="bg-black/5 dark:bg-white/10 rounded-md p-2 mb-2 border-l-4 border-green-500 text-xs cursor-pointer hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
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
          <div className="font-bold text-green-600 truncate">{name}</div>
        )}
      </div>

      <div
        className="line-clamp-2 opacity-70"
        dangerouslySetInnerHTML={{ __html: getText() }}
      ></div>
    </div>
  )
}
