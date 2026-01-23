package api

import (
	"fmt"

	"github.com/nyaruka/phonenumbers"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

func (a *Api) GetProfile(jidStr string) (Contact, error) {
	var targetJID types.JID
	if jidStr == "" {
		if a.waClient.Store.ID == nil {
			return Contact{}, fmt.Errorf("not logged in")
		}
		targetJID = *a.waClient.Store.ID
	} else {
		var err error
		targetJID, err = types.ParseJID(jidStr)
		if err != nil {
			return Contact{}, fmt.Errorf("invalid JID: %w", err)
		}
	}

	contact, _ := a.waClient.Store.Contacts.GetContact(a.ctx, targetJID.ToNonAD())
	rawNum := "+" + targetJID.User

	jid := rawNum
	num, err := phonenumbers.Parse(rawNum, "")
	if err == nil && phonenumbers.IsValidNumber(num) {
		jid = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
	}

	pic, _ := a.waClient.GetProfilePictureInfo(a.ctx, targetJID, &whatsmeow.GetProfilePictureParams{
		Preview: true,
	})
	var avatarURL string
	if pic != nil {
		avatarURL = pic.URL
	}

	pushName := contact.PushName
	// If it's self, try to get pushname from store if contact pushname is empty
	if jidStr == "" && a.waClient.Store.PushName != "" {
		pushName = a.waClient.Store.PushName
	}

	return Contact{
		Phno:       jid,
		JID:        targetJID.String(),
		FullName:   contact.FullName,
		Short:      contact.FirstName,
		PushName:   pushName,
		IsBusiness: contact.BusinessName != "",
		AvatarURL:  avatarURL,
	}, nil
}
