import * as Picker from "emoji-picker-react/primitives"
import type { EmojiClickData } from "emoji-picker-react/primitives"
import "./emojiPicker.css"

const WHATSAPP_REACTIONS = ["1f44d", "2764-fe0f", "1f602", "1f62e", "1f622", "1f64f"]

interface EmojiPickerLazyProps {
  onEmojiClick: (emoji: EmojiClickData) => void
  reactions?: boolean
}

function FullPicker() {
  return (
    <>
      <Picker.Search />
      <Picker.Viewport>
        <Picker.List />
        <Picker.Empty />
        <Picker.Loading />
        <Picker.LoadError />
      </Picker.Viewport>
      <Picker.CategoryNav />
    </>
  )
}

export default function EmojiPickerLazy({ onEmojiClick, reactions = false }: EmojiPickerLazyProps) {
  if (reactions) {
    return (
      <Picker.Root
        appearance="default"
        emojiStyle={Picker.EmojiStyle.GOOGLE}
        lazyLoadEmojis
        className="wa-emoji-picker wa-reaction-picker"
        reactions={WHATSAPP_REACTIONS}
        reactionsDefaultOpen
        onReactionClick={onEmojiClick}
        onEmojiClick={onEmojiClick}
      >
        <Picker.Reactions />
        <Picker.Panel>
          <FullPicker />
        </Picker.Panel>
      </Picker.Root>
    )
  }

  return (
    <Picker.Root
      appearance="default"
      emojiStyle={Picker.EmojiStyle.GOOGLE}
      lazyLoadEmojis
      className="wa-emoji-picker wa-composer-picker"
      onEmojiClick={onEmojiClick}
      searchPlaceholder="Search emoji"
    >
      <FullPicker />
    </Picker.Root>
  )
}
