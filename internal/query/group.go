package query

const (
	CreateGroupsTable = `
	CREATE TABLE IF NOT EXISTS whats4linux_groups (
		jid TEXT PRIMARY KEY,
		name TEXT,
		topic TEXT,
		owner_jid TEXT,
		participant_count INTEGER
	);
	`

	InsertOrReplaceGroup = `
	INSERT OR REPLACE INTO whats4linux_groups
	(jid, name, topic, owner_jid, participant_count)
	VALUES (?, ?, ?, ?, ?);
	`

	SelectAllGroups = `
	SELECT jid, name, topic, owner_jid, participant_count
	FROM whats4linux_groups;
	`

	SelectGroupByJID = `
	SELECT jid, name, topic, owner_jid, participant_count
	FROM whats4linux_groups
	WHERE jid = ?;
	`
)
