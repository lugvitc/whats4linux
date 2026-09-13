package query

const (
	CreateArchivedChatsTable = `
	CREATE TABLE IF NOT EXISTS archived_chats (
		chat_jid TEXT PRIMARY KEY,
		archived_at INTEGER NOT NULL
	);
	`
	UpsertArchivedChat = `
	INSERT OR REPLACE INTO archived_chats (chat_jid, archived_at)
	VALUES (?, ?);
	`
	DeleteArchivedChat = `
	DELETE FROM archived_chats WHERE chat_jid = ?;
	`
	SelectArchivedChats = `
	SELECT chat_jid, archived_at FROM archived_chats;
	`
	SelectArchivedChat = `
	SELECT chat_jid FROM archived_chats WHERE chat_jid = ?;
	`
)
