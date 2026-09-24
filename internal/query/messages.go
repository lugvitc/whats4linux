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
		CREATE INDEX IF NOT EXISTS idx_messages_chat_cursor ON messages(chat_jid, timestamp DESC, message_id DESC);
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
	SELECT m.sender_jid, m.timestamp, m.is_from_me, m.text, m.reply_to_message_id, m.edited, m.forwarded,
	       mm.type, mm.file_name, mm.width, mm.height, mm.gif_playback,
	       lp.url, lp.title, lp.description,
	       CASE WHEN length(COALESCE(lp.thumbnail, x'')) > 0 OR
	                      (COALESCE(lp.direct_path, '') <> '' AND length(COALESCE(lp.media_key, x'')) > 0)
	            THEN 1 ELSE 0 END
	FROM messages AS m
	LEFT JOIN message_media AS mm ON mm.message_id = m.message_id
	LEFT JOIN link_previews AS lp ON lp.message_id = m.message_id
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
	SelectMessagesByChatBeforeCursor = `
	SELECT m.message_id, m.chat_jid, m.sender_jid, m.timestamp, m.is_from_me, m.text, m.reply_to_message_id, m.edited, m.forwarded,
	       mm.type, mm.file_name, mm.width, mm.height, mm.gif_playback,
	       lp.url, lp.title, lp.description,
	       CASE WHEN length(COALESCE(lp.thumbnail, x'')) > 0 OR
	                      (COALESCE(lp.direct_path, '') <> '' AND length(COALESCE(lp.media_key, x'')) > 0)
	            THEN 1 ELSE 0 END
	FROM (
		SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, text, reply_to_message_id, edited, forwarded
		FROM messages
		WHERE chat_jid = ?
		  AND (timestamp < ? OR (timestamp = ? AND message_id < ?))
		ORDER BY timestamp DESC, message_id DESC
		LIMIT ?
	) AS m 
	LEFT JOIN message_media AS mm ON mm.message_id = m.message_id
	LEFT JOIN link_previews AS lp ON lp.message_id = m.message_id
	ORDER BY m.timestamp ASC, m.message_id ASC
	`

	SelectLatestMessagesByChat = `
	SELECT m.message_id, m.chat_jid, m.sender_jid, m.timestamp, m.is_from_me, m.text, m.reply_to_message_id, m.edited, m.forwarded,
	       mm.type, mm.file_name, mm.width, mm.height, mm.gif_playback,
	       lp.url, lp.title, lp.description,
	       CASE WHEN length(COALESCE(lp.thumbnail, x'')) > 0 OR
	                      (COALESCE(lp.direct_path, '') <> '' AND length(COALESCE(lp.media_key, x'')) > 0)
	            THEN 1 ELSE 0 END
	FROM (
		SELECT message_id, chat_jid, sender_jid, timestamp, is_from_me, text, reply_to_message_id, edited, forwarded
		FROM messages
		WHERE chat_jid = ?
		ORDER BY timestamp DESC, message_id DESC
		LIMIT ?
	) AS m
	LEFT JOIN message_media AS mm ON mm.message_id = m.message_id
	LEFT JOIN link_previews AS lp ON lp.message_id = m.message_id
	ORDER BY m.timestamp ASC, m.message_id ASC
	`

	// SelectDecodedMessagesByIDPrefix is completed with a placeholder list and
	// a closing parenthesis. It loads quoted-message summaries in one query.
	SelectDecodedMessagesByIDPrefix = `
	SELECT m.message_id, m.sender_jid, m.text, mm.type, mm.file_name,
	       mm.width, mm.height, mm.gif_playback
	FROM messages AS m
	LEFT JOIN message_media AS mm ON mm.message_id = m.message_id
	WHERE m.message_id IN (
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
	  AND m.chat_jid NOT LIKE '%@newsletter'
	  AND m.chat_jid NOT LIKE '%@broadcast'
	ORDER BY m.timestamp DESC;
	`

	// Same as SelectDecodedChatList but only Channels (newsletter feeds).
	SelectDecodedChannelList = `
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
	  AND m.chat_jid LIKE '%@newsletter'
	ORDER BY m.timestamp DESC;
	`

	UpdateMessagesChat = `
	UPDATE messages
	SET chat_jid = ?
	WHERE chat_jid = ?;
	`

	CreatePollsTable = `
	CREATE TABLE IF NOT EXISTS polls (
		message_id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		options_json TEXT NOT NULL,
		selectable_count INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
	);
	`

	InsertPoll = `
	INSERT OR REPLACE INTO polls (message_id, name, options_json, selectable_count)
	VALUES (?, ?, ?, ?)
	`

	SelectPollByMessageID = `
	SELECT name, options_json, selectable_count
	FROM polls
	WHERE message_id = ?
	LIMIT 1
	`

	SelectPollMessageInfo = `
	SELECT chat_jid, sender_jid, is_from_me, timestamp
	FROM messages
	WHERE message_id = ?
	`

	CreatePollVotesTable = `
	CREATE TABLE IF NOT EXISTS poll_votes (
		poll_message_id TEXT NOT NULL,
		sender_jid TEXT NOT NULL,
		options_json TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (poll_message_id, sender_jid),
		FOREIGN KEY (poll_message_id) REFERENCES messages(message_id) ON DELETE CASCADE
	);
	`

	UpsertPollVote = `
	INSERT OR REPLACE INTO poll_votes (poll_message_id, sender_jid, options_json, updated_at)
	VALUES (?, ?, ?, ?)
	`

	DeletePollVote = `
	DELETE FROM poll_votes WHERE poll_message_id = ? AND sender_jid = ?
	`

	SelectPollVotesByMessageID = `
	SELECT sender_jid, options_json, updated_at
	FROM poll_votes
	WHERE poll_message_id = ?
	ORDER BY updated_at ASC
	`

	SelectPollVotesByMessageIDsPrefix = `
	SELECT poll_message_id, sender_jid, options_json, updated_at
	FROM poll_votes
	WHERE poll_message_id IN (
	`
)
