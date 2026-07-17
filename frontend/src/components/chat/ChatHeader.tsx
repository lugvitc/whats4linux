import { GoBackIcon } from "../../assets/svgs/header_icons"
import { InfoIcon } from "../../assets/svgs/chat_info_icons"
interface ChatHeaderProps {
  chatName: string
  chatSubtitle?: string
  chatAvatar?: string
  onBack?: () => void
  onInfoClick?: () => void
}

export function ChatHeader({
  chatName,
  chatSubtitle,
  chatAvatar,
  onBack,
  onInfoClick,
}: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between p-3 bg-light-secondary dark:bg-dark-bg border-b border-gray-300 dark:border-white/5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {onBack && (
          <button onClick={onBack} className="mr-4 md:hidden">
            <GoBackIcon />
          </button>
        )}
        <div className="flex items-center gap-3 cursor-pointer min-w-0" onClick={onInfoClick}>
          <div className="w-10 h-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-bold overflow-hidden">
            {chatAvatar ? (
              <img src={chatAvatar} alt={chatName} className="w-full h-full object-cover" />
            ) : (
              chatName.substring(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-medium text-gray-800 dark:text-gray-100 truncate">
              {chatName}
            </h2>
            {chatSubtitle && (
              <div className="text-xs text-gray-500 dark:text-[#8696a0] truncate">
                {chatSubtitle}
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={onInfoClick}
        className="p-1 shrink-0 hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors"
        aria-label="Chat info"
      >
        <InfoIcon />
      </button>
    </div>
  )
}
