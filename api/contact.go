package api

import (
	"context"
	"fmt"

	"github.com/nyaruka/phonenumbers"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

type Contact struct {
	Phno       string `json:"phno"`
	JID     string `json:"jid"`
	Short      string `json:"short"`
	FullName   string `json:"full_name"`
	PushName   string `json:"push_name"`
	IsBusiness bool   `json:"is_business"`
	AvatarURL  string `json:"avatar_url"`
}

func canonicalUserJID(ctx context.Context, client *whatsmeow.Client, jid types.JID) types.JID {
	if jid.ActualAgent() == types.LIDDomain {
		if pn, err := client.Store.LIDs.GetPNForLID(ctx, jid); err == nil {
			jid = pn
		}
	}
	return jid.ToNonAD()
}

func (a *Api) GetContact(jid types.JID) (*Contact, error) {
	jid = canonicalUserJID(a.ctx, a.waClient, jid)
	contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, jid)
	if err != nil {
		return nil, err
	}
	rawNum := "+" + jid.User
	// Parse phone number to use as International Format
	num, err := phonenumbers.Parse(rawNum, "")
	if err != nil {
		return nil, fmt.Errorf("invalid phone number")
	}

	return &Contact{
		Phno:       phonenumbers.Format(num, phonenumbers.INTERNATIONAL),
		JID:        jid.String(),
		FullName:   contact.FullName,
		Short:      contact.FirstName,
		PushName:   contact.PushName,
		IsBusiness: contact.BusinessName != "",
	}, nil
}

func (a *Api) FetchContacts() ([]Contact, error) {
	rawContacts, err := a.waClient.Store.Contacts.GetAllContacts(a.ctx)
	if err != nil {
		return nil, err
	}
	contacts := make([]Contact, 0, len(rawContacts))
	var result []Contact
	for jid, c := range rawContacts {
		rawNum := "+" + jid.User
		// Parse phone number to use as International Format
		num, err := phonenumbers.Parse(rawNum, "")
		if err != nil && !phonenumbers.IsValidNumber(num) {
			continue
		}

		contacts = append(contacts, Contact{
			Phno:       phonenumbers.Format(num, phonenumbers.INTERNATIONAL),
			JID:     jid.String(),
			FullName:   c.FullName,
			Short:      c.FirstName,
			PushName:   c.PushName,
			IsBusiness: c.BusinessName != "",
		})
	}
	return result, nil
}
