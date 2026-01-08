import { GoBackIcon } from "../../assets/svgs/header_icons"
import { InfoIcon } from "../../assets/svgs/chat_info_icons"
interface ChatHeaderProps {
  chatName: string
  chatAvatar?: string
  onBack?: () => void
  onInfoClick?: () => void
}

export function ChatHeader({ chatName, chatAvatar, onBack, onInfoClick }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between p-3 bg-light-secondary dark:bg-dark-secondary border-b border-gray-300 dark:border-dark-tertiary">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="mr-4 md:hidden">
            <GoBackIcon />
          </button>
        )}
        <div className="flex items-center gap-3 cursor-pointer" onClick={onInfoClick}>
          <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-bold overflow-hidden">
            {chatAvatar ? (
              <img src={chatAvatar} alt={chatName} className="w-full h-full object-cover" />
            ) : (
              chatName.substring(0, 1).toUpperCase()
            )}
          </div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{chatName}</h2>
        </div>
      </div>

      <button
        onClick={onInfoClick}
        className="p-1 hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors"
        aria-label="Chat info"
      >
        <InfoIcon />
      </button>
    </div>
  )
}
