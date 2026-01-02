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

	CreateSchema = `
	CREATE TABLE IF NOT EXISTS messages (
		chat TEXT NOT NULL,
		message_id TEXT PRIMARY KEY,
		timestamp INTEGER,
		msg_info BLOB,
		raw_message BLOB
	);

	CREATE INDEX IF NOT EXISTS idx_messages_chat_time
	ON messages(chat, timestamp DESC);
	`

	InsertMessage = `
	INSERT OR IGNORE INTO messages
	(chat, message_id, timestamp, msg_info, raw_message)
	VALUES (?, ?, ?, ?, ?)
	`

	SelectAllMessages = `
	SELECT chat, message_id, timestamp, msg_info, raw_message
	FROM messages
	ORDER BY timestamp ASC
	`

	SelectMessagesByChat = `
	SELECT chat, message_id, timestamp, msg_info, raw_message
	FROM messages
	WHERE chat = ?
	ORDER BY timestamp ASC
	`

	SelectChatList = `
	SELECT chat, message_id, timestamp, msg_info, raw_message
	FROM (
		SELECT 
			chat, message_id, timestamp, msg_info, raw_message,
			ROW_NUMBER() OVER (
				PARTITION BY chat
				ORDER BY timestamp DESC, rowid DESC
			) AS rn
		FROM messages
	)
	WHERE rn = 1
	ORDER BY timestamp DESC;
	`

	SelectMessagesByChatBeforeTimestamp = `
	SELECT chat, message_id, timestamp, msg_info, raw_message
	FROM (
		SELECT chat, message_id, timestamp, msg_info, raw_message
		FROM messages
		WHERE chat = ? AND timestamp < ?
		ORDER BY timestamp DESC
		LIMIT ?
	)
	ORDER BY timestamp ASC
	`

	SelectLatestMessagesByChat = `
	SELECT chat, message_id, timestamp, msg_info, raw_message
	FROM (
		SELECT chat, message_id, timestamp, msg_info, raw_message
		FROM messages
		WHERE chat = ?
		ORDER BY timestamp DESC
		LIMIT ?
	)
	ORDER BY timestamp ASC
	`
)
