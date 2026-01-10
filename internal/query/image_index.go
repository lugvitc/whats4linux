package query

const (
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
)
