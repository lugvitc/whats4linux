package query

const (
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
	// Reactions queries
	InsertReaction = `
	INSERT INTO reactions (message_id, sender_id, emoji)
	VALUES (?, ?, ?)
	`

	DeleteReaction = `
	DELETE FROM reactions
	WHERE message_id = ? AND sender_id = ? AND emoji = ?
	`

	DeleteReactionsByMessageIDAndSenderID = `
	DELETE FROM reactions 
	WHERE message_id = ? AND sender_id = ?
	`

	SelectReactionsByMessageID = `
	SELECT id, message_id, sender_id, emoji
	FROM reactions
	WHERE message_id = ?
	ORDER BY id ASC
	`
)
