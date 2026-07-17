package api

import (
	"log"

	"github.com/lugvitc/whats4linux/internal/wa"
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
			name := ""
			if groupInfo, err := a.cw.FetchGroup(cm.JID.String()); err == nil {
				name = groupInfo.Name
			}
			// Rows synced during early history sync can be stored with an
			// empty name (and left groups have no row at all). Repair once
			// from the server and persist so later calls stay local.
			if name == "" {
				if gi, gerr := a.waClient.GetGroupInfo(a.ctx, cm.JID); gerr == nil && gi != nil {
					name = gi.GroupName.Name
					if serr := a.cw.StoreGroup(wa.Group{
						JID:              cm.JID.String(),
						Name:             gi.GroupName.Name,
						Topic:            gi.GroupTopic.Topic,
						OwnerJID:         gi.OwnerJID.String(),
						ParticipantCount: len(gi.Participants),
					}); serr != nil {
						log.Println("GetChatList: failed to persist repaired group:", cm.JID.String(), serr)
					}
				} else {
					log.Println("GetChatList: group lookup failed, using fallback:", cm.JID.String(), gerr)
				}
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
