package query

const (
	CreatePinnedMessagesTable = `
	CREATE TABLE IF NOT EXISTS pinned_messages (
		message_id TEXT PRIMARY KEY,
		chat_jid TEXT PRIMARY KEY,
		sender_jid TEXT NOT NULL,
		pinned_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_pinned_messages_chat_jid ON pinned_messages(chat_jid);
	CREATE INDEX IF NOT EXISTS idx_pinned_messages_sender_jid ON pinned_messages(sender_jid);
	CREATE INDEX IF NOT EXISTS idx_pinned_messages_pinned_at ON pinned_messages(pinned_at DESC);
	`
	InsertPinnedMessages = `
	INSERT OR REPLACE INTO pinned_messages 
	(message_id, chat_jid, sender_jid, pinned_at)
	VALUES (?, ?, ?, ?) 
	`
	GetChatPinnedMessages = `
	SELECT message_id, chat_jid, sender_jid, pinned_at
	FROM pinned_messages
	WHERE chat_jid = ?
	ORDER BY pinned_at ASC;
	`
	DeletePinnedMessageByMessageId = `
	DELETE FROM pinned_messages
	WHERE message_jid = ?;
	`
)
