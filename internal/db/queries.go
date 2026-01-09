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

	// Image cache queries
	CreateImageIndexTable = `
	CREATE TABLE IF NOT EXISTS image_index (
		message_id TEXT PRIMARY KEY,
		sha256     TEXT NOT NULL,
		mime       TEXT,
		width      INTEGER,
		height     INTEGER,
		created_at INTEGER
	);
	CREATE INDEX IF NOT EXISTS idx_sha ON image_index (sha256);
	`

	SaveImageIndex = `
	INSERT OR REPLACE INTO image_index
	(message_id, sha256, mime, width, height, created_at)
	VALUES (?, ?, ?, ?, ?, ?)
	`

	DeleteImageIndex = `
	DELETE FROM image_index
	WHERE message_id = ?
	`

	GetImageByID = `
	SELECT message_id, sha256, mime, width, height, created_at
	FROM image_index
	WHERE message_id = ?
	`

	// GetImagesByIDsPrefix is the prefix used to query multiple image IDs.
	// Use it with a dynamically built placeholder list, e.g.
	// q := query.GetImagesByIDsPrefix + strings.Join(placeholders, ",") + ")"
	GetImagesByIDsPrefix = `
	SELECT message_id, sha256, mime, width, height, created_at
	FROM image_index
	WHERE message_id IN (
	`

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
		forwarded BOOLEAN DEFAULT FALSE,
		raw_message BLOB
	);
	CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
	CREATE INDEX IF NOT EXISTS idx_messages_sender_jid ON messages(sender_jid);
	CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
	`

	CreateReactionsTable = `
	CREATE TABLE IF NOT EXISTS reactions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id TEXT NOT NULL,
		sender_id TEXT NOT NULL,
		emoji TEXT NOT NULL,
		FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);
	CREATE INDEX IF NOT EXISTS idx_reactions_sender_id ON reactions(sender_id);
	`

	InsertDecodedMessage = `
	INSERT OR REPLACE INTO messages 
	(message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded, raw_message)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	SelectDecodedMessageByID = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded
	FROM messages
	WHERE message_id = ?
	`

	SelectMessageWithRawByID = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded, raw_message
	FROM messages
	WHERE message_id = ?
	`

	SelectMessageWithRawByChatAndID = `
	SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, type, text, media_type, reply_to_message_id, edited, forwarded, raw_message
	FROM messages
	WHERE chat_jid = ? AND message_id = ?
	LIMIT 1
	`

	UpdateDecodedMessage = `
	UPDATE messages
	SET text = ?, type = ?, edited = TRUE, raw_message = ?
	WHERE message_id = ?
	`

	// Reactions queries
	InsertReaction = `
	INSERT INTO reactions (message_id, sender_id, emoji)
	VALUES (?, ?, ?)
	`

	DeleteReaction = `
	DELETE FROM reactions
	WHERE message_id = ? AND sender_id = ? AND emoji = ?
	`

	SelectReactionsByMessageID = `
	SELECT id, message_id, sender_id, emoji
	FROM reactions
	WHERE message_id = ?
	ORDER BY id ASC
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
