package api

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gen2brain/beeep"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

func (a *Api) DownloadMedia(chatJID string, messageID string) (string, error) {
	msg, err := a.messageStore.GetMessageWithMedia(chatJID, messageID)
	if err != nil || msg == nil {
		return "", fmt.Errorf("message not found")
	}

	mime := msg.Media.GetMimetype()
	width, height := msg.Media.GetDimensions()

	mediaType := msg.Media.GetMediaType()
	if mediaType == whatsmeow.MediaImage && mime == "" {
		mime = "image/jpeg"
	}
	data, err := a.waClient.Download(a.ctx, msg.Media)
	if err != nil {
		return "", fmt.Errorf("failed to download media: %v", err)
	}

	// Save to cache for images and stickers
	if mediaType == whatsmeow.MediaImage {
		_, err = a.imageCache.SaveImage(messageID, data, mime, width, height)
		if err != nil {
			// Log error but continue
		}
	}

	return base64.StdEncoding.EncodeToString(data), nil
}

// downloadMedia downloads media from a message and returns data, mime, width, height
func (a *Api) downloadMedia(msg *store.ExtendedMessage) ([]byte, string, int, int, error) {
	data, err := a.waClient.Download(a.ctx, msg.Media)
	mime := msg.Media.GetMimetype()

	if mime == "" && msg.Media.GetMediaType() == whatsmeow.MediaImage {
		mime = "image/jpeg"
	}
	width, height := msg.Media.GetDimensions()

	return data, mime, width, height, err
}

func (a *Api) GetCachedImage(messageID string) (string, error) {
	// Try to read from cache first
	data, mime, err := a.imageCache.ReadImageByMessageID(messageID)
	if err == nil {
		return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)), nil
	}

	// Image not in cache, download and cache it
	msg, err := a.messageStore.GetMessageWithMediaByID(messageID)
	if err != nil || msg == nil {
		return "", fmt.Errorf("message not found")
	}

	data, mime, width, height, err := a.downloadMedia(msg)
	if err != nil {
		return "", fmt.Errorf("failed to download image: %w", err)
	}

	_, err = a.imageCache.SaveImage(messageID, data, mime, width, height)
	if err != nil {
		// Don't fail, still return the data
	}

	return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)), nil
}

// GetCachedImages retrieves multiple cached images by message IDs (batch operation)
// Returns map of message IDs to data URLs
func (a *Api) GetCachedImages(messageIDs []string) (map[string]string, error) {
	result := make(map[string]string)
	metas, err := a.imageCache.GetImagesByMessageIDs(messageIDs)
	if err != nil {
		return nil, err
	}

	for msgID, meta := range metas {
		if meta != nil {
			data, mime, err := a.imageCache.ReadImageByMessageID(msgID)
			if err == nil {
				result[msgID] = fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
			}
		}
	}

	return result, nil
}

// GetCachedAvatar retrieves or downloads and caches an avatar for a JID
func (a *Api) GetCachedAvatar(jid string, recache bool) (string, error) {

	// Try to get cached avatar data first
	data, mime, err := a.imageCache.ReadAvatarByJID(jid)

	if err == nil && !recache {
		avatarDataURL := fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
		return avatarDataURL, nil
	}

	// Avatar not in cache, download and cache it
	jidParsed, err := types.ParseJID(jid)
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	// Get profile picture info
	pic, err := a.waClient.GetProfilePictureInfo(a.ctx, jidParsed, &whatsmeow.GetProfilePictureParams{
		Preview: false, // Get full resolution
	})
	if err != nil || pic == nil {
		if recache {
			go a.imageCache.DeleteAvatar(jid)
		}
		return "", nil // No avatar available
	}

	// Download the avatar using standard HTTP since profile picture URLs are public
	resp, err := http.Get(pic.URL)
	if err != nil {
		return "", fmt.Errorf("failed to download avatar: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download avatar: status %d", resp.StatusCode)
	}

	// Read the image data
	data, err = io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read avatar data: %w", err)
	}

	// Determine MIME type from response header or image data
	mime = resp.Header.Get("Content-Type")
	if mime == "" {
		// Fallback to detection by file signature
		mime = "image/jpeg" // Default fallback
		if len(data) > 3 {
			switch {
			case data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47:
				mime = "image/png"
			case data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46:
				mime = "image/gif"
			case data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46:
				mime = "image/webp"
			}
		}
	}

	// Cache the avatar
	_, err = a.imageCache.SaveAvatar(jid, data, mime)
	if err != nil {
		log.Printf("[GetCachedAvatar] Failed to cache avatar for %s: %v", jid, err)
		return "", fmt.Errorf("failed to cache avatar: %w", err)
	}

	// Return data URL like message images do
	avatarDataURL := fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))

	return avatarDataURL, nil
}

// GetSelfAvatar retrieves the avatar of the logged-in user
//
// We need to check canonical JID as if we check store's ID, it
// contains the device ID like so:
// XXXX:45@s.whatsapp.net instead of XXXX:@s.whatsapp.net
func (a *Api) GetSelfAvatar(recache bool) (string, error) {
	jid := canonicalUserJID(a.ctx, a.waClient, *a.waClient.Store.ID)
	selfJID := jid.String()

	avatar, err := a.GetCachedAvatar(selfJID, true)
	if err != nil {
		log.Printf("[SelfAvatar] GetCachedAvatar failed: %v", err)
		return "", err
	}

	if avatar == "" {
		log.Printf("[SelfAvatar] WhatsApp returned no avatar for self")
		return "", nil
	}

	return avatar, nil
}

// getFileExtension returns file extension for mime type
func getFileExtension(mime string) string {
	switch mime {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	default:
		return ".jpg"
	}
}

// DownloadImageToFile downloads an image from cache to the Downloads folder
func (a *Api) DownloadImageToFile(messageID string) error {
	data, mime, err := a.imageCache.ReadImageByMessageID(messageID)
	if err != nil {
		return err
	}

	homeDir, _ := os.UserHomeDir()
	downloadsDir := filepath.Join(homeDir, "Downloads")
	fileName := messageID + getFileExtension(mime)
	filePath := filepath.Join(downloadsDir, fileName)

	// Check if file exists and prompt for new path
	if _, err := os.Stat(filePath); err == nil {
		if filePath, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			DefaultDirectory: downloadsDir,
			DefaultFilename:  fileName,
			Title:            "File already exists. Save as...",
			Filters:          []runtime.FileFilter{{DisplayName: "Image Files", Pattern: "*" + getFileExtension(mime)}},
		}); err != nil || filePath == "" {
			return err
		}
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return err
	}

	beeep.Notify("whats4linux", "Downloaded: "+filePath, "")
	go func() {
		if _, err := exec.LookPath("mpg123"); err == nil {
			exec.Command("mpg123", "./beep.mp3").Run()
		}
	}()
	return nil
}
