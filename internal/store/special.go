package store

import (
	"fmt"
	"html"
	"regexp"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
)

// vcardTelRE pulls the first phone number out of a vCard payload.
var vcardTelRE = regexp.MustCompile(`(?m)^TEL[^:]*:(.+)$`)

func esc(s string) string { return html.EscapeString(strings.TrimSpace(s)) }

// pollFromMessage returns the poll payload
func pollFromMessage(msg *waE2E.Message) *waE2E.PollCreationMessage {
	if msg == nil {
		return nil
	}
	if poll := msg.GetPollCreationMessage(); poll != nil {
		return poll
	}
	if poll := msg.GetPollCreationMessageV2(); poll != nil {
		return poll
	}
	return msg.GetPollCreationMessageV3()
}

func mapsLink(lat, lng float64, label string) string {
	if label == "" {
		label = "Open in Maps"
	}
	return fmt.Sprintf(
		`<a class="msg-link" href="https://www.google.com/maps?q=%f,%f">%s</a>`,
		lat, lng, esc(label),
	)
}

func contactCard(displayName, vcard string) string {
	var b strings.Builder
	b.WriteString(`<div class="msg-card">👤 <b>` + esc(displayName) + `</b>`)
	if m := vcardTelRE.FindStringSubmatch(vcard); m != nil {
		b.WriteString(`<br>` + esc(m[1]))
	}
	b.WriteString(`</div>`)
	return b.String()
}

// DescribeSpecialMessage renders message types that have no plain-text body
// (polls, locations, contacts, invites, events, business templates) as HTML
// for the message bubble. ok=false means the type isn't special-cased.
func DescribeSpecialMessage(msg *waE2E.Message) (string, bool) {
	if msg == nil {
		return "", false
	}

	poll := pollFromMessage(msg)

	switch {
	case poll != nil:
		var b strings.Builder
		b.WriteString(`<div class="msg-card msg-poll">📊 <b>` + esc(poll.GetName()) + `</b>`)
		for _, opt := range poll.GetOptions() {
			b.WriteString(`<div class="poll-opt">○ ` + esc(opt.GetOptionName()) + `</div>`)
		}
		b.WriteString(`<div class="msg-card-note">Poll · vote on your phone</div></div>`)
		return b.String(), true

	case msg.GetLocationMessage() != nil:
		loc := msg.GetLocationMessage()
		label := loc.GetName()
		if label == "" {
			label = loc.GetAddress()
		}
		if label == "" {
			label = "Location"
		}
		out := `<div class="msg-card">📍 ` +
			mapsLink(loc.GetDegreesLatitude(), loc.GetDegreesLongitude(), label)
		if loc.GetAddress() != "" && loc.GetAddress() != label {
			out += `<br><span class="msg-card-note">` + esc(loc.GetAddress()) + `</span>`
		}
		return out + `</div>`, true

	case msg.GetLiveLocationMessage() != nil:
		live := msg.GetLiveLocationMessage()
		out := `<div class="msg-card">📍 Live location · ` +
			mapsLink(live.GetDegreesLatitude(), live.GetDegreesLongitude(), "last position")
		if live.GetCaption() != "" {
			out += `<br>` + esc(live.GetCaption())
		}
		return out + `</div>`, true

	case msg.GetContactMessage() != nil:
		c := msg.GetContactMessage()
		return contactCard(c.GetDisplayName(), c.GetVcard()), true

	case msg.GetContactsArrayMessage() != nil:
		arr := msg.GetContactsArrayMessage()
		var b strings.Builder
		for _, c := range arr.GetContacts() {
			b.WriteString(contactCard(c.GetDisplayName(), c.GetVcard()))
		}
		if b.Len() == 0 {
			return `<div class="msg-card">👤 ` + esc(arr.GetDisplayName()) + `</div>`, true
		}
		return b.String(), true

	case msg.GetGroupInviteMessage() != nil:
		inv := msg.GetGroupInviteMessage()
		out := `<div class="msg-card">👥 Group invite: <b>` + esc(inv.GetGroupName()) + `</b>`
		if inv.GetInviteCode() != "" {
			out += `<br><a class="msg-link" href="https://chat.whatsapp.com/` +
				esc(inv.GetInviteCode()) + `">chat.whatsapp.com/` + esc(inv.GetInviteCode()) + `</a>`
		}
		if inv.GetCaption() != "" {
			out += `<br>` + esc(inv.GetCaption())
		}
		return out + `</div>`, true

	case msg.GetEventMessage() != nil:
		ev := msg.GetEventMessage()
		out := `<div class="msg-card">📅 <b>` + esc(ev.GetName()) + `</b>`
		if ev.GetIsCanceled() {
			out += ` <i>(canceled)</i>`
		}
		if ev.GetStartTime() > 0 {
			out += `<br>` + esc(time.Unix(ev.GetStartTime(), 0).Format("Mon, Jan 2 · 3:04 PM"))
		}
		if loc := ev.GetLocation(); loc != nil && loc.GetName() != "" {
			out += `<br>📍 ` + esc(loc.GetName())
		}
		if ev.GetDescription() != "" {
			out += `<br><span class="msg-card-note">` + esc(ev.GetDescription()) + `</span>`
		}
		return out + `</div>`, true

	case msg.GetButtonsMessage() != nil && msg.GetButtonsMessage().GetContentText() != "":
		return esc(msg.GetButtonsMessage().GetContentText()), true

	case msg.GetListMessage() != nil:
		lst := msg.GetListMessage()
		out := esc(lst.GetTitle())
		if lst.GetDescription() != "" {
			if out != "" {
				out += "<br>"
			}
			out += esc(lst.GetDescription())
		}
		if out == "" {
			return "", false
		}
		return out, true

	case msg.GetTemplateMessage() != nil:
		if t := msg.GetTemplateMessage().GetHydratedTemplate(); t != nil && t.GetHydratedContentText() != "" {
			return esc(t.GetHydratedContentText()), true
		}
		return "", false
	}

	return "", false
}

// SpecialPreview is the chat-list one-liner for special message types.
func SpecialPreview(msg *waE2E.Message) (string, bool) {
	if msg == nil {
		return "", false
	}
	if poll := pollFromMessage(msg); poll != nil {
		return "📊 " + esc(poll.GetName()), true
	}
	switch {
	case msg.GetLocationMessage() != nil, msg.GetLiveLocationMessage() != nil:
		return "📍 Location", true
	case msg.GetContactMessage() != nil:
		return "👤 " + esc(msg.GetContactMessage().GetDisplayName()), true
	case msg.GetContactsArrayMessage() != nil:
		return "👤 Contacts", true
	case msg.GetGroupInviteMessage() != nil:
		return "👥 Group invite", true
	case msg.GetEventMessage() != nil:
		return "📅 " + esc(msg.GetEventMessage().GetName()), true
	case msg.GetPtvMessage() != nil:
		return "🎥 Video note", true
	}
	return "", false
}

// ShouldSkipMessage reports protocol noise that must never create a visible
// chat row (poll votes, keep-in-chat markers, remaining protocol messages —
// edits and revokes are handled before this check).
func ShouldSkipMessage(msg *waE2E.Message) bool {
	if msg == nil {
		return true
	}
	return msg.GetPollUpdateMessage() != nil ||
		msg.GetKeepInChatMessage() != nil ||
		msg.GetProtocolMessage() != nil
}
