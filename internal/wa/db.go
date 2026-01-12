package wa

import (
	"context"
	"database/sql"
	"fmt"
	"sync"

	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/query"

	"go.mau.fi/whatsmeow"
)

type AppDatabase struct {
	db  *sql.DB
	mu  sync.Mutex
	ctx context.Context
}

func NewAppDatabase(ctx context.Context) (*AppDatabase, error) {
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("app.db"))
	if err != nil {
		return nil, err
	}
	return &AppDatabase{
		db:  db,
		ctx: ctx,
	}, nil
}

func (cw *AppDatabase) Initialise(client *whatsmeow.Client) error {
	_, err := cw.db.Exec(query.CreateGroupsTable)
	if err != nil {
		return fmt.Errorf("failed to create whats4linux_groups table: %w", err)
	}

	err = cw.FetchAndStoreGroups(client)
	if err != nil {
		return fmt.Errorf("failed to fetch and store groups: %w", err)
	}
	return nil
}

func (cw *AppDatabase) FetchAndStoreGroups(client *whatsmeow.Client) error {
	cw.mu.Lock()
	defer cw.mu.Unlock()

	groups, err := client.GetJoinedGroups(cw.ctx)
	if err != nil {
		return fmt.Errorf("failed to fetch joined groups: %w", err)
	}

	tx, err := cw.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(query.InsertOrReplaceGroup)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, group := range groups {
		_, err := stmt.Exec(
			group.JID.String(),
			group.Name,
			group.Topic,
			group.OwnerJID.String(),
			len(group.Participants),
		)
		if err != nil {
			return fmt.Errorf("failed to insert group %s: %w", group.JID.String(), err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

type Group struct {
	JID              string
	Name             string
	Topic            string
	OwnerJID         string
	ParticipantCount int
}

func (cw *AppDatabase) FetchGroups() ([]Group, error) {
	rows, err := cw.db.Query(query.SelectAllGroups)
	if err != nil {
		return nil, fmt.Errorf("failed to query groups: %w", err)
	}
	defer rows.Close()

	var groups []Group
	for rows.Next() {
		var g Group
		err := rows.Scan(&g.JID, &g.Name, &g.Topic, &g.OwnerJID, &g.ParticipantCount)
		if err != nil {
			return nil, fmt.Errorf("failed to scan group row: %w", err)
		}
		groups = append(groups, g)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %w", err)
	}

	return groups, nil
}

func (cw *AppDatabase) FetchGroup(jid string) (*Group, error) {
	row := cw.db.QueryRow(query.SelectGroupByJID, jid)

	var g Group
	err := row.Scan(&g.JID, &g.Name, &g.Topic, &g.OwnerJID, &g.ParticipantCount)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("group with JID %s not found", jid)
		}
		return nil, fmt.Errorf("failed to scan group row: %w", err)
	}

	return &g, nil
}

func (cw *AppDatabase) Close() error {
	return cw.db.Close()
}
