package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type AssetFileServer struct {
	http.Handler
}

func NewAssetFileServer() *AssetFileServer {
	return &AssetFileServer{}
}

func (h *AssetFileServer) ServeHTTP(res http.ResponseWriter, req *http.Request) {
	if strings.HasPrefix(req.URL.Path, "/cached-image/") {
		requestedFilename := strings.TrimPrefix(req.URL.Path, "/cached-image/")

		// Security: Prevent directory traversal
		// We only expect flat filenames (hashes + extension)
		if filepath.Base(requestedFilename) != requestedFilename {
			res.WriteHeader(http.StatusBadRequest)
			return
		}

		cacheDir, _ := os.UserCacheDir()
		fullPath := filepath.Join(cacheDir, "whats4linux", "images", requestedFilename)

		// Check if file exists
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			res.WriteHeader(http.StatusNotFound)
			return
		}

		http.ServeFile(res, req, fullPath)
		return
	}
	res.WriteHeader(http.StatusNotFound)
}
