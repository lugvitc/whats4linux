package api

import (
	"github.com/lugvitc/whats4linux/internal/misc"
	"go.mau.fi/whatsmeow/types"
)

type ChatElement struct {
	LatestMessage string `json:"latest_message"`
	LatestTS      int64
	Sender        string
	Contact
}

var tmpProfileCache = misc.NewVMap[string, string]()

func (a *Api) GetChatList() ([]ChatElement, error) {
	cmList := a.messageStore.GetChatList()
	ce := make([]ChatElement, len(cmList))
	for i, cm := range cmList {
		var fc Contact
		if cm.JID.Server == types.GroupServer {
			groupInfo, err := a.cw.FetchGroup(cm.JID.String())
			if err != nil {
				return nil, err
			}
			fc = Contact{
				RawJID: cm.JID.String(),
				FullName: groupInfo.Name,
			}
		} else {
			contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, cm.JID)
			if err != nil {
				return nil, err
			}


			fc = Contact{
				RawJID:     cm.JID.String(),
				Short:      contact.FirstName,
				FullName:   contact.FullName,
				PushName:   contact.PushName,
				IsBusiness: contact.BusinessName != "",
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

func (a *Api) SendChatPresence(jid string, cp types.ChatPresence, cpm types.ChatPresenceMedia) error {
	parsedJid, err := types.ParseJID(jid)
	if err != nil {
		return err
	}
	return a.waClient.SendChatPresence(a.ctx, parsedJid, cp, cpm)
}
