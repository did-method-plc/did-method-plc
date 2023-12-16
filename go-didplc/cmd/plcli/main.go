package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/bluesky-social/indigo/atproto/crypto"
	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/did-method-plc/did-method-plc/go-didplc"

	"github.com/urfave/cli/v2"
)

func main() {
	app := cli.App{
		Name:  "plcli",
		Usage: "simple CLI client tool for PLC operations",
	}
	app.Flags = []cli.Flag{
		&cli.StringFlag{
			Name:    "plc-host",
			Usage:   "method, hostname, and port of PLC registry",
			Value:   "https://plc.directory",
			EnvVars: []string{"PLC_HOST"},
		},
	}
	app.Commands = []*cli.Command{
		&cli.Command{
			Name:      "resolve",
			Usage:     "resolve a DID from remote PLC directory",
			ArgsUsage: "<did>",
			Action:    runResolve,
		},
		&cli.Command{
			Name:      "submit",
			Usage:     "submit a PLC operation (reads JSON from stdin)",
			ArgsUsage: "<did>",
			Action:    runSubmit,
			Flags: []cli.Flag{
				&cli.StringFlag{
					Name:    "plc-private-rotation-key",
					Usage:   "private key used as a rotation key, if operation is not signed (multibase syntax)",
					EnvVars: []string{"PLC_PRIVATE_ROTATION_KEY"},
				},
			},
		},
		&cli.Command{
			Name:      "oplog",
			Usage:     "fetch log of operations from PLC directory, for a single DID",
			ArgsUsage: "<did>",
			Action:    runOpLog,
			Flags: []cli.Flag{
				&cli.BoolFlag{
					Name:  "audit",
					Usage: "audit mode, with nullified entries included",
				},
			},
		},
		&cli.Command{
			Name:      "verify",
			Usage:     "fetch audit log for a DID, and verify all operations",
			ArgsUsage: "<did>",
			Action:    runVerify,
			Flags: []cli.Flag{
				&cli.BoolFlag{
					Name:  "audit",
					Usage: "audit mode, with nullified entries included",
				},
			},
		},
	}
	h := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})
	slog.SetDefault(slog.New(h))
	app.RunAndExitOnError()
}

func runResolve(cctx *cli.Context) error {
	ctx := context.Background()
	s := cctx.Args().First()
	if s == "" {
		fmt.Println("need to provide DID as an argument")
		os.Exit(-1)
	}

	did, err := syntax.ParseDID(s)
	if err != nil {
		fmt.Println(err)
		os.Exit(-1)
	}

	c := didplc.Client{
		DirectoryURL: cctx.String("plc-host"),
	}
	doc, err := c.Resolve(ctx, did.String())
	if err != nil {
		return err
	}
	jsonBytes, err := json.Marshal(&doc)
	if err != nil {
		return err
	}
	fmt.Println(string(jsonBytes))
	return nil
}

func runSubmit(cctx *cli.Context) error {
	ctx := context.Background()
	s := cctx.Args().First()
	if s == "" {
		fmt.Println("need to provide DID as an argument")
		os.Exit(-1)
	}

	did, err := syntax.ParseDID(s)
	if err != nil {
		return err
	}

	c := didplc.Client{
		DirectoryURL: cctx.String("plc-host"),
	}

	inBytes, err := io.ReadAll(os.Stdin)
	if err != nil {
		return err
	}
	var enum didplc.OpEnum
	if err := json.Unmarshal(inBytes, &enum); err != nil {
		return err
	}
	op := enum.AsOperation()

	if !op.IsSigned() {
		privStr := cctx.String("plc-private-rotation-key")
		if privStr == "" {
			return fmt.Errorf("operation is not signed and no privte key provided")
		}
		priv, err := crypto.ParsePrivateMultibase(privStr)
		if err != nil {
			return err
		}
		if err := op.Sign(priv); err != nil {
			return err
		}
	}

	entry, err := c.Submit(ctx, did.String(), op)
	if err != nil {
		return err
	}
	jsonBytes, err := json.Marshal(&entry)
	if err != nil {
		return err
	}
	fmt.Println(string(jsonBytes))
	return nil
}

func fetchOplog(cctx *cli.Context) ([]didplc.LogEntry, error) {
	ctx := context.Background()
	s := cctx.Args().First()
	if s == "" {
		return nil, fmt.Errorf("need to provide DID as an argument")
	}

	did, err := syntax.ParseDID(s)
	if err != nil {
		return nil, err
	}

	c := didplc.Client{
		DirectoryURL: cctx.String("plc-host"),
	}
	entries, err := c.OpLog(ctx, did.String(), cctx.Bool("audit"))
	if err != nil {
		return nil, err
	}
	return entries, nil
}

func runOpLog(cctx *cli.Context) error {
	entries, err := fetchOplog(cctx)
	if err != nil {
		return err
	}

	jsonBytes, err := json.Marshal(&entries)
	if err != nil {
		return err
	}
	fmt.Println(string(jsonBytes))
	return nil
}

func runVerify(cctx *cli.Context) error {
	entries, err := fetchOplog(cctx)
	if err != nil {
		return err
	}

	err = didplc.VerifyOpLog(entries)
	if err != nil {
		return err
	}

	fmt.Println("valid")
	return nil
}
