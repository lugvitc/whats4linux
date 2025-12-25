package misc

import (
	"fmt"
	"os"
	"path/filepath"
)

const APP_NAME = "whats4linux"

var ConfigDir = defaultConfigDir()

func GetSQLiteAddress(dbName string) string {
	path := filepath.Join(ConfigDir, dbName)
	return fmt.Sprintf("file:%s?_foreign_keys=on", path)
}

func defaultConfigDir() string {
	cdr, err := os.UserConfigDir()
	if err != nil {
		panic(err)
	}
	cdr = filepath.Join(cdr, APP_NAME)
	if !dirExists(cdr) {
		err = os.MkdirAll(cdr, os.ModePerm)
		if err != nil {
			panic(err)
		}
	}
	return cdr
}

func dirExists(name string) bool {
	_, err := os.ReadDir(name)
	return !os.IsNotExist(err)
}
