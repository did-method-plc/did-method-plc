package didplc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/bluesky-social/indigo/atproto/crypto"
)

// the zero-value of this client is fully functional
type Client struct {
	DirectoryURL string
	UserAgent    *string
	HTTPClient   http.Client
	RotationKey  *crypto.PrivateKey
}

var (
	ErrDIDNotFound      = errors.New("DID not found in PLC directory")
	DefaultDirectoryURL = "https://plc.directory"
)

func (c *Client) Resolve(ctx context.Context, did string) (*Doc, error) {
	if !strings.HasPrefix(did, "did:plc:") {
		return nil, fmt.Errorf("expected a did:plc, got: %s", did)
	}

	plcURL := c.DirectoryURL
	if plcURL == "" {
		plcURL = DefaultDirectoryURL
	}

	url := plcURL + "/" + did
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	if c.UserAgent != nil {
		req.Header.Set("User-Agent", *c.UserAgent)
	} else {
		req.Header.Set("User-Agent", "go-did-method-plc")
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed did:plc directory resolution: %w", err)
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrDIDNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed did:web well-known fetch, HTTP status: %d", resp.StatusCode)
	}

	var doc Doc
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, fmt.Errorf("failed parse of did:plc document JSON: %w", err)
	}
	return &doc, nil
}

func (c *Client) Submit(ctx context.Context, did string, op Operation) (*LogEntry, error) {
	if !strings.HasPrefix(did, "did:plc:") {
		return nil, fmt.Errorf("expected a did:plc, got: %s", did)
	}

	plcURL := c.DirectoryURL
	if plcURL == "" {
		plcURL = DefaultDirectoryURL
	}

	var body io.Reader
	b, err := json.Marshal(op)
	if err != nil {
		return nil, err
	}
	body = bytes.NewReader(b)

	url := plcURL + "/" + did
	req, err := http.NewRequestWithContext(ctx, "POST", url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.UserAgent != nil {
		req.Header.Set("User-Agent", *c.UserAgent)
	} else {
		req.Header.Set("User-Agent", "go-did-method-plc")
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("did:plc operation submission failed: %w", err)
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrDIDNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed did:plc operation submission, HTTP status: %d", resp.StatusCode)
	}

	var entry LogEntry
	if err := json.NewDecoder(resp.Body).Decode(&entry); err != nil {
		return nil, fmt.Errorf("failed parse of did:plc op log entry: %w", err)
	}
	return &entry, nil
}

func (c *Client) OpLog(ctx context.Context, did string, audit bool) ([]LogEntry, error) {
	if !strings.HasPrefix(did, "did:plc:") {
		return nil, fmt.Errorf("expected a did:plc, got: %s", did)
	}

	plcURL := c.DirectoryURL
	if plcURL == "" {
		plcURL = DefaultDirectoryURL
	}

	url := plcURL + "/" + did + "/log"
	if audit {
		url += "/audit"
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	if c.UserAgent != nil {
		req.Header.Set("User-Agent", *c.UserAgent)
	} else {
		req.Header.Set("User-Agent", "go-did-method-plc")
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed did:plc directory resolution: %w", err)
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrDIDNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed did:web well-known fetch, HTTP status: %d", resp.StatusCode)
	}

	var entries []LogEntry
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return nil, fmt.Errorf("failed parse of did:plc document JSON: %w", err)
	}
	return entries, nil
}
