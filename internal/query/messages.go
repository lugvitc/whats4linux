package query

const (

	// Messages database queries (messages.db)
	CreateMessagesTable = `
	CREATE TABLE IF NOT EXISTS messages (
		message_id TEXT PRIMARY KEY,
		chat_jid TEXT NOT NULL,
		sender_jid TEXT NOT NULL,
		timestamp INTEGER NOT NULL,
		is_from_me BOOLEAN NOT NULL,
		type INTEGER NOT NULL,
		text TEXT,
		media_type INTEGER,
		reply_to_message_id TEXT,
		edited BOOLEAN DEFAULT FALSE,
		forwarded BOOLEAN DEFAULT FALSE
	);
	CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
	CREATE INDEX IF NOT EXISTS idx_messages_sender_jid ON messages(sender_jid);
	CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
	`

	InsertDecodedMessage = `
	INSERT OR REPLACE INTO messages 
	(message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	SelectDecodedMessageByID = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
	FROM messages
	WHERE message_id = ?
	`

	SelectMessageWithRawByID = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
	FROM messages
	WHERE message_id = ?
	`

	SelectMessageWithRawByChatAndID = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
	FROM messages
	WHERE chat_jid = ? AND message_id = ?
	LIMIT 1
	`

	UpdateDecodedMessage = `
	UPDATE messages
	SET text = ?, type = ?, edited = TRUE
	WHERE message_id = ?
	`

	// Migration queries for messages.db
	SelectAllMessagesJIDs = `
	SELECT message_id, chat_jid, sender_jid
	FROM messages;
	`

	UpdateMessageJIDs = `
	UPDATE messages
	SET chat_jid = ?, sender_jid = ?
	WHERE message_id = ?;
	`

	// Messages.db paged queries (for frontend)
	SelectDecodedMessagesByChatBeforeTimestamp = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
	FROM (
		SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
		FROM messages
		WHERE chat_jid = ? AND timestamp < ?
		ORDER BY timestamp DESC
		LIMIT ?
	)
	ORDER BY timestamp ASC
	`

	SelectLatestDecodedMessagesByChat = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
	FROM (
		SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
		FROM messages
		WHERE chat_jid = ?
		ORDER BY timestamp DESC
		LIMIT ?
	)
	ORDER BY timestamp ASC
	`

	SelectDecodedMessageByChatAndID = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
	FROM messages
	WHERE chat_jid = ? AND message_id = ?
	LIMIT 1
	`

	// Chat list from messages.db
	SelectDecodedChatList = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
	FROM (
		SELECT 
			message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded,
			ROW_NUMBER() OVER (
				PARTITION BY chat_jid
				ORDER BY timestamp DESC
			) AS rn
		FROM messages
	)
	WHERE rn = 1
	ORDER BY timestamp DESC;
	`

	UpdateMessagesChat = `
	UPDATE messages
	SET chat_jid = ?
	WHERE chat_jid = ?;
	`
)
