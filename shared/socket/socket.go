package socket

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var UDSPath = os.TempDir() + "/whats4linux.sock"

// CommandHandler is invoked for socket commands that aren't handled by the
// built-in window commands (show/hide/quit). It returns the reply to send back
// on the connection ("" for none) and whether the command was recognised.
type CommandHandler func(cmd string) (reply string, handled bool)

type UnixSocket struct {
	mu       sync.Mutex
	ctx      context.Context
	conn     net.Conn
	listener net.Listener
	handler  CommandHandler
	closed   bool
	quitting atomic.Bool
	// hidden mirrors the last reported window visibility so a tray that
	// connects later (or reconnects) starts with the right menu item.
	hidden atomic.Bool
}

func NewUnixSocket(ctx context.Context) (*UnixSocket, error) {
	return &UnixSocket{
		ctx: ctx,
	}, nil
}

// SetCommandHandler registers a handler for app-specific commands (e.g. the
// systray notification toggle). Must be set before ListenAndServe.
func (s *UnixSocket) SetCommandHandler(handler CommandHandler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handler = handler
}

func (s *UnixSocket) ListenAndServe() error {
	if err := os.RemoveAll(UDSPath); err != nil {
		return err
	}
	listener, err := net.Listen("unix", UDSPath)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = listener.Close()
		_ = os.Remove(UDSPath)
		return nil
	}
	s.listener = listener
	s.mu.Unlock()
	defer func() {
		_ = listener.Close()
		s.mu.Lock()
		if s.listener == listener {
			s.listener = nil
		}
		s.mu.Unlock()
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			s.mu.Lock()
			closed := s.closed
			s.mu.Unlock()
			if closed {
				return nil
			}
			log.Println("accept error:", err)
			continue
		}
		s.handleConn(conn)
	}
}

// handleConn serves a single client (the systray) over a persistent
// connection. Commands are newline-delimited; replies/pushes are written back
// on the same connection via SendCommand.
func (s *UnixSocket) handleConn(conn net.Conn) {
	s.mu.Lock()
	s.conn = conn
	handler := s.handler
	s.mu.Unlock()

	// Sync the tray's Open/Hide item with the current window state.
	if err := s.SendCommand(windowStateMessage(!s.hidden.Load())); err != nil {
		log.Println("socket write error:", err)
	}

	defer func() {
		s.mu.Lock()
		if s.conn == conn {
			s.conn = nil
		}
		s.mu.Unlock()
		conn.Close()
	}()

	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		msg := scanner.Text()
		if msg == "" {
			continue
		}

		switch msg {
		case "show":
			runtime.WindowUnminimise(s.ctx)
			runtime.Show(s.ctx)
			s.NotifyWindowVisible(true)
		case "hide":
			runtime.Hide(s.ctx)
			s.NotifyWindowVisible(false)
		case "quit":
			log.Println("Quit signal received from systray")
			s.quitting.Store(true)
			runtime.Quit(s.ctx)
		default:
			if handler != nil {
				if reply, handled := handler(msg); handled {
					if reply != "" {
						if err := s.SendCommand(reply); err != nil {
							log.Println("socket reply error:", err)
						}
					}
					continue
				}
			}
			fmt.Println("unknown command:", msg)
		}
	}
	if err := scanner.Err(); err != nil {
		log.Println("read error:", err)
	}
}

// Window visibility messages pushed to the tray so its Open/Hide menu item
// matches the real window state, however the window was shown or hidden.
const (
	WindowStateShown  = "window_state:shown"
	WindowStateHidden = "window_state:hidden"
)

// NotifyWindowVisible tells the tray (if connected) whether the window is
// visible. Best-effort.
func (s *UnixSocket) NotifyWindowVisible(visible bool) {
	s.hidden.Store(!visible)
	_ = s.SendCommand(windowStateMessage(visible))
}

func windowStateMessage(visible bool) string {
	if visible {
		return WindowStateShown
	}
	return WindowStateHidden
}

// QuitRequested reports whether the tray asked the app to quit, so the
// close-to-tray hook must let the shutdown through.
func (s *UnixSocket) QuitRequested() bool {
	return s.quitting.Load()
}

// Connected reports whether a tray client is currently connected.
func (s *UnixSocket) Connected() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn != nil
}

// SendCommand writes a newline-framed message to the connected client.
func (s *UnixSocket) SendCommand(cmd string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn == nil {
		return fmt.Errorf("not connected to socket")
	}
	_, err := s.conn.Write([]byte(cmd + "\n"))
	if err != nil {
		defer s.conn.Close()
		s.conn = nil
	}
	return err
}

// Close stops the listener, closes the tray connection, and removes the socket
// file. It is safe to call more than once.
func (s *UnixSocket) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	listener := s.listener
	conn := s.conn
	s.listener = nil
	s.conn = nil
	s.mu.Unlock()

	var closeErr error
	if conn != nil {
		closeErr = conn.Close()
	}
	if listener != nil {
		if err := listener.Close(); closeErr == nil {
			closeErr = err
		}
	}
	if err := os.Remove(UDSPath); err != nil && !os.IsNotExist(err) && closeErr == nil {
		closeErr = err
	}
	return closeErr
}
