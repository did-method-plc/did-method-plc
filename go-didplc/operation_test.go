package didplc

import (
	"encoding/json"
	"io"
	"os"
	"testing"

	"github.com/bluesky-social/indigo/atproto/crypto"
	"github.com/bluesky-social/indigo/atproto/syntax"

	"github.com/stretchr/testify/assert"
)

func loadTestLogEntries(t *testing.T, p string) []LogEntry {
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()

	fileBytes, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}

	var entries []LogEntry
	if err := json.Unmarshal(fileBytes, &entries); err != nil {
		t.Fatal(err)
	}

	return entries
}

func TestLogEntryValidate(t *testing.T) {
	assert := assert.New(t)

	list := []string{
		"testdata/log_bskyapp.json",
		"testdata/log_legacy_dholms.json",
		"testdata/log_bnewbold_robocracy.json",
	}
	for _, p := range list {
		entries := loadTestLogEntries(t, p)
		for _, le := range entries {
			assert.NoError(le.Validate())
		}
	}
}

func TestCreatePLC(t *testing.T) {
	assert := assert.New(t)

	priv, err := crypto.GeneratePrivateKeyP256()
	if err != nil {
		t.Fatal(err)
	}
	pub, err := priv.PublicKey()
	if err != nil {
		t.Fatal(err)
	}
	pubDIDKey := pub.DIDKey()
	handleURI := "at://handle.example.com"
	endpoint := "https://pds.example.com"
	op := RegularOp{
		Type:         "plc_operation",
		RotationKeys: []string{pubDIDKey},
		VerificationMethods: map[string]string{
			"atproto": pubDIDKey,
		},
		AlsoKnownAs: []string{handleURI},
		Services: map[string]OpService{
			"atproto_pds": OpService{
				Type:     "AtprotoPersonalDataServer",
				Endpoint: endpoint,
			},
		},
		Prev: nil,
		Sig:  nil,
	}
	assert.NoError(op.Sign(priv))
	assert.NoError(op.VerifySignature(pub))
	did, err := op.DID()
	if err != nil {
		t.Fatal(err)
	}
	_, err = syntax.ParseDID(did)
	assert.NoError(err)

	le := LogEntry{
		DID:       did,
		Operation: OpEnum{Regular: &op},
		CID:       op.CID().String(),
		Nullified: false,
		CreatedAt: syntax.DatetimeNow().String(),
	}
	assert.NoError(le.Validate())

	_, err = op.Doc(did)
	assert.NoError(err)
}
