package main

import (
	"embed"
	"fmt"

	"os"

	"github.com/lugvitc/whats4linux/cmd"
)

//go:embed all:frontend/dist
var assets embed.FS

// these variable are set at build time
var (
	version   string = "0.0.0"
	commit    string
	date      string
	buildType string = "unclassified"
)

func main() {
	os.Exit(runMain(os.Args, run))
}

func run(args []string) error {
	return cmd.Execute(args, assets, cmd.BuildArgs{
		Version:   version,
		Commit:    commit,
		Date:      date,
		BuildType: buildType,
	})
}

func runMain(args []string, runFunc func([]string) error) int {
	if err := runFunc(args); err != nil {
		fmt.Printf("%s: %s\n", cmd.APP_NAME, err.Error())
		return 1
	}
	return 0
}
