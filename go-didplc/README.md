
`go-didplc`: did:plc in golang
==============================

This golang package will eventually be an implementation of the did:plc specification in golang, including at a minimum verification of DID documents from a PLC operation log.

For now it primarily contains a basic website for the PLC directory, allowing lookup of individual DID documents.


## Developer Quickstart

Install golang. We are generally using v1.20+.

In this directory (`go-didplc/`):

    # re-build and run daemon
    go run ./cmd/webplc serve

    # build and output a binary
    go build -o webplc ./cmd/webplc/

The easiest way to configure the daemon is to copy `example.env` to `.env` and
fill in auth values there.
