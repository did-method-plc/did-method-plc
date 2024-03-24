package didplc

import (
	"encoding/base64"
	"testing"

	"github.com/bluesky-social/indigo/atproto/crypto"

	cbor "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/assert"
)

func TestVerifySignatureHardWay(t *testing.T) {
	assert := assert.New(t)

	sig := "n-VWsPZY4xkFN8wlg-kJBU_yzWTNd2oBnbjkjxXu3HdjbBLaEB7K39JHIPn_DZVALKRjts6bUicjSEecZy8eIw"
	didKey := "did:key:zQ3shP5TBe1sQfSttXty15FAEHV1DZgcxRZNxvEWnPfLFwLxJ"
	pub, err := crypto.ParsePublicDIDKey(didKey)
	if err != nil {
		t.Fatal(err)
	}

	obj := map[string]interface{}{
		"prev": "bafyreigcxay6ucqlwowfpu35alyxqtv3c4vsj7gmdtmnidsnqs6nblyarq",
		"type": "plc_operation",
		"services": map[string]any{
			"atproto_pds": map[string]string{
				"type":     "AtprotoPersonalDataServer",
				"endpoint": "https://bsky.social",
			},
		},
		"alsoKnownAs": []string{
			"at://dholms.xyz",
		},
		"rotationKeys": []string{
			"did:key:zQ3shhCGUqDKjStzuDxPkTxN6ujddP4RkEKJJouJGRRkaLGbg",
			"did:key:zQ3shP5TBe1sQfSttXty15FAEHV1DZgcxRZNxvEWnPfLFwLxJ",
		},
		"verificationMethods": map[string]string{
			"atproto": "did:key:zQ3shP5TBe1sQfSttXty15FAEHV1DZgcxRZNxvEWnPfLFwLxJ",
		},
		//"sig": nil,
	}
	objBytes, err := cbor.DumpObject(obj)
	if err != nil {
		t.Fatal(err)
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		t.Fatal(err)
	}
	//fmt.Println(len(sigBytes))
	assert.NoError(pub.HashAndVerify(objBytes, sigBytes))
}

func TestVerifySignatureHardWayNew(t *testing.T) {
	assert := assert.New(t)

	sig := "v9rHEhW4XVwMKRSd2yeFgk4-mZthHSZwJ4tShNPqDP4NH3w79CkxIOmJ393D6MEyWZLN1qxS1qBIbFEGtfoDDw"
	didKey := "did:key:zQ3shcciz4AvrLyDnUdZLpQys3kyCsesojRNzJAieyDStGxGo"
	pub, err := crypto.ParsePublicDIDKey(didKey)
	if err != nil {
		t.Fatal(err)
	}

	obj := map[string]interface{}{
		"prev": nil,
		"type": "plc_operation",
		"services": map[string]any{
			"atproto_pds": map[string]string{
				"type":     "AtprotoPersonalDataServer",
				"endpoint": "https://pds.robocracy.org",
			},
		},
		"alsoKnownAs": []string{
			"at://bnewbold.pds.robocracy.org",
		},
		"rotationKeys": []string{
			"did:key:zQ3shcciz4AvrLyDnUdZLpQys3kyCsesojRNzJAieyDStGxGo",
		},
		"verificationMethods": map[string]string{
			"atproto": "did:key:zQ3shazA2airLo8gNJvxGMFZWPJDRkLGNR6mn9Txsc8YYndwy",
		},
		//"sig": nil,
	}
	objBytes, err := cbor.DumpObject(obj)
	if err != nil {
		t.Fatal(err)
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		t.Fatal(err)
	}
	assert.NoError(pub.HashAndVerify(objBytes, sigBytes))
	assert.Equal("bafyreih7k7a7v7ez7qzzxj7ywomk5hgtidpzuodjsw2kldtepdadob4hdi", computeCID(objBytes).String())
}

func TestVerifySignatureLegacyGenesis(t *testing.T) {
	assert := assert.New(t)

	sig := "7QTzqO1BcL3eDzP4P_YBxMmv5U4brHzAItkM9w5o8gZA7ElZkrVYEwsfQCfk5EoWLk58Z1y6fyNP9x1pthJnlw"
	didKey := "did:key:zQ3shP5TBe1sQfSttXty15FAEHV1DZgcxRZNxvEWnPfLFwLxJ" // signing, not recovery
	pub, err := crypto.ParsePublicDIDKey(didKey)
	if err != nil {
		t.Fatal(err)
	}

	obj := map[string]interface{}{
		"prev":        nil,
		"type":        "create",
		"handle":      "dan.bsky.social",
		"service":     "https://bsky.social",
		"signingKey":  "did:key:zQ3shP5TBe1sQfSttXty15FAEHV1DZgcxRZNxvEWnPfLFwLxJ",
		"recoveryKey": "did:key:zQ3shhCGUqDKjStzuDxPkTxN6ujddP4RkEKJJouJGRRkaLGbg",
		//"sig": nil,
	}
	objBytes, err := cbor.DumpObject(obj)
	if err != nil {
		t.Fatal(err)
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		t.Fatal(err)
	}
	assert.NoError(pub.HashAndVerify(objBytes, sigBytes))
}
