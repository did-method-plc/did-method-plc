package didplc

import (
	"encoding/base64"
	"fmt"
	"testing"

	"github.com/bluesky-social/indigo/atproto/crypto"

	cbor "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/assert"
)

func TestVerifySignatureHardWay(t *testing.T) {
	assert := assert.New(t)

	priv, err := crypto.GeneratePrivateKeyP256()
	if err != nil {
		t.Fatal(err)
	}
	newPub, err := priv.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	sig := "n-VWsPZY4xkFN8wlg-kJBU_yzWTNd2oBnbjkjxXu3HdjbBLaEB7K39JHIPn_DZVALKRjts6bUicjSEecZy8eIw"
	didKey := "did:key:zQ3shhCGUqDKjStzuDxPkTxN6ujddP4RkEKJJouJGRRkaLGbg"
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
	fmt.Println(len(sigBytes))
	assert.NoError(pub.HashAndVerify(objBytes, sigBytes))

	newSig, err := priv.HashAndSign(objBytes)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println(sig)
	fmt.Println(base64.RawURLEncoding.EncodeToString(newSig))
	assert.NoError(newPub.HashAndVerify(objBytes, newSig))
}
