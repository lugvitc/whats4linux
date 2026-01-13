package misc

import (
	"crypto/sha1"
	"encoding/binary"
)

var profileColors = []string{
	"#D38F29", "#4CAF50", "#4A90E2",
	"#DF3D3E", "#FF5722", "#03A9F4",
	"#9C27B0", "#009688", "#E542A3",
	"#A9006E", "#D81B60", "#5E35B1",
	"#3949AB", "#1E88E5", "#039BE5",
	"#00ACC1", "#00897B", "#43A047",
	"#7CB342", "#C0CA33", "#FDD835",
	"#FFB300", "#FB8C00", "#F4511E",
	"#6D4C41", "#757575",
}

func GetProfileColor(jid string) string {
	hash := sha1.Sum([]byte(jid))
	hashInt := binary.BigEndian.Uint32(hash[:4])
	color := profileColors[hashInt%uint32(len(profileColors))]
	return color
}
