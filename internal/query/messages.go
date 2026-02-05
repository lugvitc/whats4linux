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
		text TEXT,
		has_media BOOLEAN DEFAULT FALSE,
		reply_to_message_id TEXT,
		edited BOOLEAN DEFAULT FALSE,
		forwarded BOOLEAN DEFAULT FALSE,
		type INTEGER DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
	CREATE INDEX IF NOT EXISTS idx_messages_sender_jid ON messages(sender_jid);
	CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
	`

	InsertMessage = `
	INSERT OR REPLACE INTO messages 
	(message_id, chat_jid, sender_jid, timestamp, is_from_me, text, has_media, reply_to_message_id, edited, forwarded, type)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	UpdateMessage = `
	UPDATE messages
	SET text = ?, edited = TRUE
	WHERE message_id = ?
	`

	SelectMessageByID = `
	SELECT chat_jid, sender_jid, timestamp, is_from_me, text, has_media, reply_to_message_id, edited, forwarded
	FROM messages
	WHERE message_id = ?
	`

	SelectDecodedMessageByChatAndID = `
	SELECT m.sender_jid, m.timestamp, m.is_from_me, m.text, m.reply_to_message_id, m.edited, m.forwarded, mm.type, mm.file_name
	FROM messages AS m
	LEFT JOIN message_media AS mm ON mm.message_id = m.message_id
	WHERE m.chat_jid = ? AND m.message_id = ?
	LIMIT 1
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
	SelectMessagesByChatBeforeTimestamp = `
	SELECT m.message_id, m.chat_jid, m.sender_jid, m.timestamp, m.is_from_me, m.text, m.reply_to_message_id, m.edited, m.forwarded, mm.type, mm.file_name
	FROM (
		SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, text, reply_to_message_id, edited, forwarded
		FROM messages
		WHERE chat_jid = ? AND timestamp < ?
		ORDER BY timestamp DESC
		LIMIT ?
	) AS m 
	LEFT JOIN message_media AS mm ON mm.message_id = m.message_id
	ORDER BY m.timestamp ASC
	`

	SelectLatestMessagesByChat = `
	SELECT m.message_id, m.chat_jid, m.sender_jid, m.timestamp, m.is_from_me, m.text, m.reply_to_message_id, m.edited, m.forwarded, mm.type, mm.file_name
	FROM (
		SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, text, reply_to_message_id, edited, forwarded
		FROM messages
		WHERE chat_jid = ?
		ORDER BY timestamp DESC
		LIMIT ?
	) AS m
	LEFT JOIN message_media AS mm ON mm.message_id = m.message_id
	ORDER BY m.timestamp ASC
	`

	SelectMessageByChatAndID = `
	SELECT sender_jid, timestamp, is_from_me, text, has_media, reply_to_message_id, edited, forwarded
	FROM messages
	WHERE chat_jid = ? AND message_id = ?
	LIMIT 1
	`

	// Chat list from messages.db
	SelectDecodedChatList = `
	SELECT m.message_id, m.chat_jid, m.sender_jid, m.timestamp, m.is_from_me, m.text, m.reply_to_message_id, m.edited, m.forwarded, mm.type, mm.file_name
	FROM (
		SELECT 
			message_id, chat_jid, sender_jid, timestamp, is_from_me, text, reply_to_message_id, edited, forwarded,
			ROW_NUMBER() OVER (
				PARTITION BY chat_jid
				ORDER BY timestamp DESC
			) AS rn
		FROM messages
	) AS m
	LEFT JOIN message_media AS mm ON mm.message_id = m.message_id
	WHERE rn = 1
	ORDER BY m.timestamp DESC;
	`

	UpdateMessagesChat = `
	UPDATE messages
	SET chat_jid = ?
	WHERE chat_jid = ?;
	`
)
