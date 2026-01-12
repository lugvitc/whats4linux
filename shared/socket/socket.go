package socket

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var UDSPath = os.TempDir() + "/whats4linux.sock"

type UnixSocket struct {
	mu   sync.Mutex
	ctx  context.Context
	conn net.Conn
}

func NewUnixSocket(ctx context.Context) (*UnixSocket, error) {
	return &UnixSocket{
		ctx: ctx,
	}, nil
}

func (s *UnixSocket) ListenAndServe() error {
	if err := os.RemoveAll(UDSPath); err != nil {
		return err
	}
	listener, err := net.Listen("unix", UDSPath)
	if err != nil {
		return err
	}
	defer listener.Close()
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Println("accept error:", err)
			continue
		}
		s.handleConn(conn)
	}
}

func (s *UnixSocket) handleConn(conn net.Conn) {
	defer conn.Close()

	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	if err != nil && err != io.EOF {
		log.Println("read error:", err)
		return
	}

	msg := string(buf[:n])

	switch msg {
	case "show":
		runtime.WindowUnminimise(s.ctx)
		runtime.Show(s.ctx)
	case "hide":
		runtime.Hide(s.ctx)
	case "quit":
		log.Println("Quit signal received from systray")
		runtime.Quit(s.ctx)
	default:
		fmt.Println("unknown command:", msg)
	}
}

func (s *UnixSocket) SendCommand(cmd string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn == nil {
		return fmt.Errorf("not connected to socket")
	}
	_, err := s.conn.Write([]byte(cmd))
	if err != nil {
		defer s.conn.Close()
		s.conn = nil
	}
	return err
}

// func SendCommand(cmd string) {
// 	conn, err := net.Dial("unix", socketPath)
// 	if err != nil {
// 		log.Println("dial error:", err)
// 		return
// 	}
// 	defer conn.Close()

// 	_, err = conn.Write([]byte(cmd))
// 	if err != nil {
// 		log.Println("write error:", err)
// 	}
// }
