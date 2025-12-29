package lockfile

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"syscall"
)

type Lock struct {
	file *os.File
	path string
}

// Acquire creates and locks a file
// If another instance is running, it returns an error.
func Acquire(lockPath string) (*Lock, error) {
	absPath, err := filepath.Abs(lockPath)
	if err != nil {
		return nil, fmt.Errorf("[ERROR] resolve lock path: %w", err)
	}

	f, err := os.OpenFile(absPath, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return nil, fmt.Errorf("[ERROR] open lock file: %w", err)
	}

	// non-blocking excl lock
	err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err != nil {
		f.Close()

		if err == syscall.EWOULDBLOCK {
			return nil, fmt.Errorf("[ERROR] (%s) another instance of the app is already running!", absPath)
		}
		return nil, fmt.Errorf("[ERROR] flock failed: %w", err)
	}

	_ = f.Truncate(0)
	_, _ = fmt.Fprintf(f, "%d\n", os.Getpid())

	return &Lock{
		file: f,
		path: absPath,
	}, nil
}

func (l *Lock) Release() error {
	if l == nil || l.file == nil {
		return nil
	}

	if err := syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN); err != nil {
		return err
	}

	err := l.file.Close()
	_ = os.Remove(l.path)
	return err
}

func EnsureSingleInstance(lockPath string) *Lock {
	lock, err := Acquire(lockPath)
	if err != nil {
		log.Fatal(err)
	}
	return lock
}
