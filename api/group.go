package api

import (
	"fmt"
	"strings"
	"time"

	"github.com/lugvitc/whats4linux/internal/wa"
	"go.mau.fi/whatsmeow/types"
)

type Group struct {
	GroupName        string             `json:"group_name"`
	GroupTopic       string             `json:"group_topic,omitempty"`
	IsGroupLock      bool               `json:"is_group_lock"`     // whether the group info can only be edited by admins
	IsGroupAnnounce  bool               `json:"is_group_announce"` // whether only admins can send messages in the group
	GroupOwner       Contact            `json:"group_owner"`
	GroupCreatedAt   time.Time          `json:"group_created_at"`
	ParticipantCount int                `json:"participant_count"`
	Participants     []GroupParticipant `json:"group_participants"`
}

type GroupParticipant struct {
	Contact Contact `json:"contact"`
	IsAdmin bool    `json:"is_admin"`
}

func (a *Api) FetchGroups() ([]wa.Group, error) {
	groups, err := a.waClient.GetJoinedGroups(a.ctx)
	if err != nil {
		return nil, err
	}

	var result []wa.Group
	for _, g := range groups {
		result = append(result, wa.Group{
			JID:              g.JID.String(),
			Name:             g.Name,
			Topic:            g.Topic,
			OwnerJID:         g.OwnerJID.String(),
			ParticipantCount: len(g.Participants),
		})
	}
	return result, nil
}

func (a *Api) GetGroupInfo(jidStr string) (Group, error) {
	if !strings.HasSuffix(jidStr, "@g.us") {
		return Group{}, fmt.Errorf("JID is not a group JID")
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return Group{}, fmt.Errorf("Invalid JID: %w", err)
	}

	GroupInfo, err := a.waClient.GetGroupInfo(a.ctx, jid)

	if err != nil {
		return Group{}, err
	}

	var participants []GroupParticipant
	for _, p := range GroupInfo.Participants {
		contact, err := a.GetContact(p.JID)
		if err != nil {
			return Group{}, fmt.Errorf("Error fetching participant: %w", err)
		}

		participants = append(participants, GroupParticipant{
			Contact: *contact,
			IsAdmin: p.IsAdmin,
		})
	}
	owner, err := a.GetContact(GroupInfo.OwnerJID)
	if err != nil {
		return Group{}, fmt.Errorf("Error fetching owner: %w", err)
	}
	return Group{
		GroupName:        GroupInfo.GroupName.Name,
		GroupTopic:       GroupInfo.GroupTopic.Topic,
		IsGroupLock:      GroupInfo.GroupLocked.IsLocked,
		IsGroupAnnounce:  GroupInfo.GroupAnnounce.IsAnnounce,
		GroupOwner:       *owner,
		GroupCreatedAt:   GroupInfo.GroupCreated,
		ParticipantCount: GroupInfo.ParticipantCount,
		Participants:     participants,
	}, nil
}
