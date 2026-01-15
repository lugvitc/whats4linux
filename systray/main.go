package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"sync"

	"github.com/getlantern/systray"
	"github.com/lugvitc/whats4linux/shared/socket"
)

var conn net.Conn
var mu sync.Mutex

func connectSocket() error {
	var err error
	conn, err = net.Dial("unix", socket.UDSPath)
	return err
}

func readCommands() error {
	buf := make([]byte, 1024)
	for {
		n, err := conn.Read(buf)
		if err != nil {
			if err == io.EOF {
				err = connectSocket()
				if err != nil {
					return err
				}
				continue
			}
			fmt.Println("Error reading from Whats4Linux socket:", err)
			systray.Quit()
			os.Exit(0)
		}

		switch string(buf[:n]) {
		case "shutdown":
			fmt.Println("Received shutdown command from Whats4Linux, exiting systray.")
			systray.Quit()
			os.Exit(0)
		}
	}
}

func sendCommand(cmd string) {
	mu.Lock()
	defer mu.Unlock()
	_, err := conn.Write([]byte(cmd))
	if err != nil {
		fmt.Println("Error sending command to Whats4Linux:", err)
		systray.Quit()
		os.Exit(0)
	}
}

func main() {
	go func() {
		if err := connectSocket(); err != nil {
			fmt.Println("Whats4Linux not running, exiting systray.")
			os.Exit(0)
			return
		}
		if err := readCommands(); err != nil {
			fmt.Println("Error reading commands from Whats4Linux:", err)
			os.Exit(0)
			return
		}
	}()
	systray.Run(func() {
		systray.SetTemplateIcon(icon, icon)
		systray.SetTitle("Whats4Linux")
		systray.SetTooltip("Lantern")
		mQuitOrig := systray.AddMenuItem("Quit", "Quit the whole app")
		go func() {
			<-mQuitOrig.ClickedCh
			fmt.Println("Requesting quit")
			sendCommand("quit")
			systray.Quit()
			fmt.Println("Finished quitting")
		}()
		var mShow, mHide *systray.MenuItem
		mShow = systray.AddMenuItem("Open", "Open whats4linux window")
		mShow.Hide()
		mHide = systray.AddMenuItem("Hide", "Hide whats4linux window")
		go func() {
			for {
				<-mHide.ClickedCh
				mShow.Show()
				mHide.Hide()
				sendCommand("hide")
			}
		}()
		go func() {
			for {
				<-mShow.ClickedCh
				mHide.Show()
				mShow.Hide()
				sendCommand("show")
			}
		}()
	}, func() {})
}
