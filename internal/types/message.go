package types

type MessageType uint8

const (
	MessageTypeNormal MessageType = iota

	MessageTypeMessagePinned
)
