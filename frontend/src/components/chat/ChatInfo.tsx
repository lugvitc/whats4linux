import { useEffect, useState } from "react"
import { UserAvatar } from "../../assets/svgs/chat_icons"
import {
  Mediaicon,
  BlockIcon,
  ExitGroupIcon,
  MuteIcon,
  DisappearingMessagesIcon,
  ReportIcon,
} from "../../assets/svgs/chat_info_icons"
import { GetProfile, GetGroupInfo } from "../../../wailsjs/go/api/Api"
import { api } from "../../../wailsjs/go/models"
import { GoBackIcon } from "../../assets/svgs/header_icons"

interface ChatInfoProps {
  chatId: string
  chatName: string
  chatType: "group" | "contact"
  chatAvatar?: string
  isOpen: boolean
  onClose: () => void
}

export function ChatInfo({
  chatId,
  chatName,
  chatType,
  chatAvatar,
  isOpen,
  onClose,
}: ChatInfoProps) {
  const [contactInfo, setContactInfo] = useState<api.Contact | null>(null)
  const [groupInfo, setGroupInfo] = useState<api.Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAllParticipants, setShowAllParticipants] = useState(false)
  const MAX_VISIBLE = 10

  useEffect(() => {
    if (isOpen) {
      setShowAllParticipants(false)
    }
  }, [isOpen, chatId])

  useEffect(() => {
    if (isOpen) {
      loadInfo()
    }
  }, [isOpen, chatId])

  const loadInfo = async () => {
    setLoading(true)
    try {
      if (chatType === "group") {
        const info = await GetGroupInfo(chatId)
        setGroupInfo(info)
      } else {
        const info = await GetProfile(chatId)
        setContactInfo(info)
      }
    } catch (err) {
      console.error("Failed to load chat info:", err)
    } finally {
      setLoading(false)
    }
  }
  const participants = groupInfo?.group_participants ?? []
  const visibleParticipants = showAllParticipants
    ? participants
    : participants.slice(0, MAX_VISIBLE)
  const hasMore = (groupInfo?.participant_count ?? participants.length) > MAX_VISIBLE

  if (!isOpen) return null

  return (
    <div className="w-full md:w-[400px] h-full bg-white dark:bg-dark-secondary border-l border-gray-300 dark:border-dark-tertiary flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center p-4 bg-light-secondary dark:bg-dark-secondary">
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors mr-3"
          aria-label="Close"
        >
          <GoBackIcon />
        </button>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
          {chatType === "group" ? "Group Info" : "Contact Info"}
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
          </div>
        ) : (
          <>
            {/* Profile Section */}
            <div className="bg-light-secondary dark:bg-dark-secondary p-6 flex flex-col items-center">
              <div className="w-32 h-32 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-bold text-4xl overflow-hidden mb-4">
                {chatAvatar ? (
                  <img src={chatAvatar} alt={chatName} className="w-full h-full object-cover" />
                ) : (
                  <UserAvatar />
                )}
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">
                {chatType === "group"
                  ? groupInfo?.group_name
                  : contactInfo?.full_name || "~ " + contactInfo?.push_name || chatName}
              </h3>
              {chatType === "contact" && contactInfo && (
                <p className="text-sm text-gray-600 dark:text-gray-400">{contactInfo.jid}</p>
              )}
              {chatType === "group" && groupInfo && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Group · {groupInfo.participant_count} participants
                </p>
              )}
            </div>

            {/* Group Description */}
            {chatType === "group" && groupInfo?.group_topic && (
              <div className="mx-3 border-y border-gray-200 dark:border-dark-tertiary">
                <div className="p-4">
                  <p className="text-gray-900 dark:text-dark-text text-md break-words whitespace-pre-wrap">
                    {groupInfo.group_topic}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-muted mt-2">
                    Group created by{" "}
                    {groupInfo.group_owner.full_name ||
                      groupInfo.group_owner.push_name ||
                      groupInfo.group_owner.jid}
                    , on {new Date(groupInfo.group_created_at).toLocaleDateString()} at{" "}
                    {new Date(groupInfo.group_created_at).toLocaleString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            )}

            {/* About Section for Contacts */}
            {chatType === "contact" && contactInfo && (
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <div className="p-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">About</p>
                  <p className="text-gray-900 dark:text-gray-100">{"No about info"}</p>
                </div>
              </div>
            )}

            {/* Phone Number for Contacts */}
            {chatType === "contact" && contactInfo && (
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <div className="p-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Phone</p>
                  <p className="text-gray-900 dark:text-gray-100">{contactInfo.jid}</p>
                </div>
              </div>
            )}

            {/* Media, links, and docs */}
            <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
              <div className="w-full p-4  flex items-center gap-3">
                <Mediaicon />
                <span className="text-gray-900 dark:text-gray-100">Media, links and docs</span>
              </div>

              <div className="p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                  No media available
                </p>
              </div>
            </div>

            {/* Mute notifications */}
            <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
              <button className="w-full p-4 flex items-center rounded-xl m-2 justify-between hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors">
                <div className="flex items-center gap-3">
                  <MuteIcon />
                  <span className="text-gray-900 dark:text-gray-100">Mute notifications</span>
                </div>
              </button>

              {/* Disappearing messages */}
              <button className="w-full p-4 flex items-center rounded-xl m-2 justify-between hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors">
                <div className="flex items-center gap-3">
                  <DisappearingMessagesIcon />
                  <div className="flex-1 text-left">
                    <p className="text-gray-900 dark:text-gray-100">Disappearing messages</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Off</p>
                  </div>
                </div>
              </button>
            </div>

            {/* Group Participants */}
            {chatType === "group" && groupInfo && (
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <span className="w-full p-4 flex items-center justify-between transition-colors">
                  <span className="text-gray-900 dark:text-gray-100">
                    {groupInfo.participant_count} members
                  </span>
                </span>

                <div className="max-h-96 overflow-y-auto">
                  {visibleParticipants.map((participant: any) => (
                    <div
                      key={participant.contact.jid}
                      className="flex items-center gap-3 p-3 rounded-xl m-2 hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                    >
                      <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-bold overflow-hidden">
                        {participant.contact.avatar_url ? (
                          <img
                            src={participant.contact.avatar_url}
                            alt={participant.contact.push_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <UserAvatar />
                        )}
                      </div>

                      <div className="flex-1">
                        <p className="text-gray-900 dark:text-gray-100 font-medium">
                          {participant.contact.full_name || "~ " + participant.contact.push_name}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {participant.contact.jid}
                        </p>
                      </div>

                      {participant.is_admin && (
                        <span className="text-xs px-3 py-1 rounded-full bg-green-900/30 text-[#C8ECC5]">
                          Group admin
                        </span>
                      )}
                    </div>
                  ))}

                  {hasMore && !showAllParticipants && (
                    <button
                      onClick={() => setShowAllParticipants(true)}
                      className="w-full p-3 text-sm font-medium text-blue-600 dark:text-green hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                    >
                      View all members ({groupInfo.participant_count - MAX_VISIBLE} more)
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* Block/Report (for contacts) */}
            {chatType === "contact" && (
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <button className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-red-600 dark:text-red-400">
                  <BlockIcon />
                  <span>Block {contactInfo?.full_name || contactInfo?.jid || "contact"}</span>
                </button>
                <button className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-red-600 dark:text-red-400">
                  <ReportIcon />
                  <span>Report contact</span>
                </button>
              </div>
            )}

            {/* Exit group (for groups) */}
            {chatType === "group" && (
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <button className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-red-600 dark:text-red-400">
                  <ExitGroupIcon />
                  <span>Exit group</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
