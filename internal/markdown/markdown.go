package markdown

// TODO :  triple backtick blocks
import (
	"html"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

var urlRE = regexp.MustCompile(`https?://[^\s<]+|www\.[^\s<]+`)

// linkifyAndEscape HTML-escapes plain text and wraps any URLs in anchor tags
// (class msg-link so the frontend can open them in the system browser).
func linkifyAndEscape(s string) string {
	var out strings.Builder
	last := 0
	for _, loc := range urlRE.FindAllStringIndex(s, -1) {
		out.WriteString(html.EscapeString(s[last:loc[0]]))
		raw := s[loc[0]:loc[1]]
		// Trim trailing punctuation that's usually sentence punctuation, not URL.
		trimmed := strings.TrimRight(raw, ".,!?;:)")
		trailing := raw[len(trimmed):]
		href := trimmed
		if strings.HasPrefix(trimmed, "www.") {
			href = "https://" + trimmed
		}
		out.WriteString(`<a href="` + html.EscapeString(href) +
			`" class="msg-link" rel="noreferrer noopener">` + html.EscapeString(trimmed) + `</a>`)
		out.WriteString(html.EscapeString(trailing))
		last = loc[1]
	}
	out.WriteString(html.EscapeString(s[last:]))
	return out.String()
}

var Tokens = map[string]string{
	"*": "b",
	"`": "span class=\"inline-code\"",
	"_": "i",
	"~": "s",
}

func openTag(tag string) string {
	return "<" + tag + ">"
}

func closeTag(tag string) string {
	return "</" + tag + ">"
}

func isWord(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

// inline parser
func ParseInline(s string) string {
	var out strings.Builder
	var buf strings.Builder
	var active string
	var openPos int
	var lastClose int = -1

	flushPlain := func() {
		if buf.Len() > 0 {
			out.WriteString(linkifyAndEscape(buf.String()))
			buf.Reset()
		}
	}

	for i := 0; i < len(s); {
		var matched string
		for tok := range Tokens {
			if strings.HasPrefix(s[i:], tok) {
				matched = tok
				break
			}
		}

		if matched != "" {
			var prev, next rune
			if i > 0 {
				prev, _ = utf8.DecodeLastRuneInString(s[:i])
			}
			if i+1 < len(s) {
				next, _ = utf8.DecodeRuneInString(s[i+1:])
			}
			if isWord(prev) && isWord(next) {
				buf.WriteByte(s[i])
				i++
				continue
			}

			switch active {
			case matched:
				lastClose = buf.Len()
				buf.WriteString(matched)
				i += len(matched)
				continue

			case "":
				flushPlain()
				active = matched
				openPos = buf.Len()
				lastClose = -1
				buf.WriteString(matched)

			default:
				buf.WriteString(matched)
			}

			i += len(matched)
			continue
		}

		buf.WriteByte(s[i])
		i++
	}
	if active != "" &&
		lastClose > openPos &&
		strings.TrimSpace(
			buf.String()[openPos+len(active):lastClose],
		) != "" {
		before := buf.String()[:openPos]
		content := buf.String()[openPos+len(active) : lastClose]
		after := buf.String()[lastClose+len(active):]

		out.WriteString(linkifyAndEscape(before))
		out.WriteString(openTag(Tokens[active]))
		out.WriteString(html.EscapeString(content))
		out.WriteString(closeTag(Tokens[active]))
		out.WriteString(linkifyAndEscape(after))
	} else {
		out.WriteString(linkifyAndEscape(buf.String()))
	}

	return out.String()
}

func isUnorderedList(line string) (bool, string) {
	if len(line) < 3 {
		return false, ""
	}

	switch line[0] {
	case '-', '*':
		if line[1] == ' ' && line[2] != ' ' {
			return true, strings.TrimRight(line[2:], "\n")
		}
	}

	return false, ""
}

// line parser (for quotes and lists[pending])
func MarkdownLinesToHTML(s string) string {
	lines := strings.Split(s, "\n")
	var out strings.Builder

	inQuote := false
	inUL := false

	closeAll := func() {
		if inUL {
			out.WriteString("</ul>")
			inUL = false
		}
		if inQuote {
			out.WriteString("</blockquote>")
			inQuote = false
		}
	}

	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			closeAll()
			out.WriteString("<br>")
			continue
		}
		// blockquote
		if strings.HasPrefix(line, "> ") {
			if !inQuote {
				closeAll()
				out.WriteString("<blockquote>")
				inQuote = true
			}
			out.WriteString(ParseInline(line[2:]))
			continue
		}

		// unordered list
		if ok, content := isUnorderedList(line); ok {
			if !inUL {
				closeAll()
				out.WriteString("<ul>")
				inUL = true
			}
			out.WriteString("<li>")
			out.WriteString(ParseInline(content))
			out.WriteString("</li>")
			continue
		}

		// normal line
		closeAll()
		if strings.TrimSpace(line) != "" {
			out.WriteString("<p>")
			out.WriteString(ParseInline(line))
			out.WriteString("</p>")
		}
	}

	closeAll()
	return out.String()
}
