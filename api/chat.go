package api

import (
	"log"

	"go.mau.fi/whatsmeow/types"
)

type ChatElement struct {
	LatestMessage string `json:"latest_message"`
	LatestTS      int64
	Sender        string
	Contact
}

func (a *Api) GetChatList() ([]ChatElement, error) {
	cmList := a.messageStore.GetChatList()
	ce := make([]ChatElement, len(cmList))
	for i, cm := range cmList {
		var fc Contact
		if cm.JID.Server == types.GroupServer {
			// Local-only on purpose: this runs at startup before the client
			// has connected, so it must never touch the network. Empty names
			// are healed asynchronously by repairGroupNames after Connected.
			name := ""
			if groupInfo, err := a.cw.FetchGroup(cm.JID.String()); err == nil {
				name = groupInfo.Name
			} else {
				log.Println("GetChatList: group lookup failed, using fallback:", cm.JID.String(), err)
			}
			if name == "" {
				// A single unknown/left group must not blank the whole chat
				// list. Fall back to the JID so the chat still renders.
				name = cm.JID.User
			}
			fc = Contact{
				JID:      cm.JID.String(),
				FullName: name,
			}
		} else {
			contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, cm.JID)
			if err != nil {
				// Same here: degrade to the JID rather than failing everything.
				log.Println("GetChatList: contact lookup failed, using fallback:", cm.JID.String(), err)
				fc = Contact{
					JID:      cm.JID.String(),
					PushName: cm.JID.User,
				}
			} else {
				fc = Contact{
					JID:        cm.JID.String(),
					Short:      contact.FirstName,
					FullName:   contact.FullName,
					PushName:   contact.PushName,
					IsBusiness: contact.BusinessName != "",
				}
			}
		}
		ce[i] = ChatElement{
			LatestMessage: cm.MessageText,
			LatestTS:      cm.MessageTime,
			Sender:        cm.Sender,
			Contact:       fc,
		}
	}
	return ce, nil
}

// GetChannelList returns the followed Channels (newsletter feeds), named via
// their newsletter metadata.
func (a *Api) GetChannelList() ([]ChatElement, error) {
	cmList := a.messageStore.GetChannelList()
	ce := make([]ChatElement, len(cmList))
	for i, cm := range cmList {
		name := cm.JID.User
		if info, err := a.waClient.GetNewsletterInfo(a.ctx, cm.JID); err == nil && info != nil && info.ThreadMeta.Name.Text != "" {
			name = info.ThreadMeta.Name.Text
		}
		ce[i] = ChatElement{
			LatestMessage: cm.MessageText,
			LatestTS:      cm.MessageTime,
			Sender:        cm.Sender,
			Contact:       Contact{JID: cm.JID.String(), FullName: name},
		}
	}
	return ce, nil
}

func (a *Api) SendChatPresence(jid string, cp types.ChatPresence, cpm types.ChatPresenceMedia) error {
	parsedJid, err := types.ParseJID(jid)
	if err != nil {
		return err
	}
	return a.waClient.SendChatPresence(a.ctx, parsedJid, cp, cpm)
}
