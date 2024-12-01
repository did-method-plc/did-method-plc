
`web.plc.directory`
===================

This is a basic website for the PLC directory, allowing lookup of individual DID documents. It also hosts a copy of the PLC specs.


## Developer Quickstart

Install golang. We are generally using v1.22+.

In this directory (`website/`):

    # re-build and run daemon
    go run . serve

    # build and output a binary
    go build -o webplc .

The easiest way to configure the daemon is to copy `example.env` to `.env` and fill in auth values there.
