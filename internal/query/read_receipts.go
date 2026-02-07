package query

const (
	CreateReadReceiptsTable = `
	CREATE TABLE IF NOT EXISTS read_receipts (
		chat_jid TEXT PRIMARY KEY,
		read_after_timestamp INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_read_receipts_timestamp ON read_receipts(read_after_timestamp);
	`

	InsertOrUpdateReadReceipt = `
	INSERT OR REPLACE INTO read_receipts 
	(chat_jid, read_after_timestamp)
	VALUES (?, ?)
	`

	SelectReadReceiptByChatJID = `
	SELECT chat_jid, read_after_timestamp
	FROM read_receipts
	WHERE chat_jid = ?
	`

	SelectAllReadReceipts = `
	SELECT chat_jid, read_after_timestamp
	FROM read_receipts
	ORDER BY read_after_timestamp DESC
	`

	DeleteReadReceiptByChatJID = `
	DELETE FROM read_receipts
	WHERE chat_jid = ?
	`
)
