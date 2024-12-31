package didplc

import (
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/bluesky-social/indigo/atproto/crypto"

	"github.com/ipfs/go-cid"
	cbor "github.com/ipfs/go-ipld-cbor"
)

type Operation interface {
	// CID of the full (signed) operation
	CID() cid.Cid
	// serializes a copy of the op as CBOR, with the `sig` field omitted
	UnsignedCBORBytes() []byte
	// serializes a copy of the op as CBOR, with the `sig` field included
	SignedCBORBytes() []byte
	// whether this operation is a genesis (creation) op
	IsGenesis() bool
	// whether this operation has a signature or is unsigned
	IsSigned() bool
	// returns the DID for a genesis op (errors if this op is not a genesis op)
	DID() (string, error)
	// signs the object in-place
	Sign(priv crypto.PrivateKey) error
	// verifiy signature. returns crypto.ErrInvalidSignature if appropriate
	VerifySignature(pub crypto.PublicKey) error
	// returns a DID doc
	Doc(did string) (Doc, error)
}

type OpService struct {
	Type     string `json:"type" cborgen:"type"`
	Endpoint string `json:"endpoint" cborgen:"endpoint"`
}

type RegularOp struct {
	Type                string               `json:"type,const=plc_operation" cborgen:"type,const=plc_operation"`
	RotationKeys        []string             `json:"rotationKeys" cborgen:"rotationKeys"`
	VerificationMethods map[string]string    `json:"verificationMethods" cborgen:"verificationMethods"`
	AlsoKnownAs         []string             `json:"alsoKnownAs" cborgen:"alsoKnownAs"`
	Services            map[string]OpService `json:"services" cborgen:"services"`
	Prev                *string              `json:"prev" cborgen:"prev"`
	Sig                 *string              `json:"sig,omitempty" cborgen:"sig,omitempty" refmt:"sig,omitempty"`
}

type TombstoneOp struct {
	Type string  `json:"type,const=plc_tombstone" cborgen:"type,const=plc_tombstone"`
	Prev string  `json:"prev" cborgen:"prev"`
	Sig  *string `json:"sig,omitempty" cborgen:"sig,omitempty" refmt:"sig,omitempty"`
}

type LegacyOp struct {
	Type        string  `json:"type,const=create" cborgen:"type,const=create"`
	SigningKey  string  `json:"signingKey" cborgen:"signingKey"`
	RecoveryKey string  `json:"recoveryKey" cborgen:"recoveryKey"`
	Handle      string  `json:"handle" cborgen:"handle"`
	Service     string  `json:"service" cborgen:"service"`
	Prev        *string `json:"prev" cborgen:"prev"`
	Sig         *string `json:"sig,omitempty" cborgen:"sig,omitempty" refmt:"sig,omitempty"`
}

var _ Operation = (*RegularOp)(nil)
var _ Operation = (*TombstoneOp)(nil)
var _ Operation = (*LegacyOp)(nil)

// any of: Op, TombstoneOp, or LegacyOp
type OpEnum struct {
	Regular   *RegularOp
	Tombstone *TombstoneOp
	Legacy    *LegacyOp
}

var ErrNotGenesisOp = errors.New("not a genesis PLC operation")

func init() {
	cbor.RegisterCborType(OpService{})
	cbor.RegisterCborType(RegularOp{})
	cbor.RegisterCborType(TombstoneOp{})
	cbor.RegisterCborType(LegacyOp{})
}

func computeCID(b []byte) cid.Cid {
	cidBuilder := cid.V1Builder{Codec: 0x71, MhType: 0x12, MhLength: 0}
	c, err := cidBuilder.Sum(b)
	if err != nil {
		return cid.Undef
	}
	return c
}

func (op *RegularOp) CID() cid.Cid {
	return computeCID(op.SignedCBORBytes())
}

func (op *RegularOp) UnsignedCBORBytes() []byte {
	unsigned := RegularOp{
		Type:                op.Type,
		RotationKeys:        op.RotationKeys,
		VerificationMethods: op.VerificationMethods,
		AlsoKnownAs:         op.AlsoKnownAs,
		Services:            op.Services,
		Prev:                op.Prev,
		Sig:                 nil,
	}

	out, err := cbor.DumpObject(unsigned)
	if err != nil {
		return nil
	}
	return out
}

func (op *RegularOp) SignedCBORBytes() []byte {
	out, err := cbor.DumpObject(op)
	if err != nil {
		return nil
	}
	return out
}

func (op *RegularOp) IsGenesis() bool {
	return op.Prev == nil
}

func (op *RegularOp) IsSigned() bool {
	return op.Sig != nil && *op.Sig != ""
}

func (op *RegularOp) DID() (string, error) {
	if !op.IsGenesis() {
		return "", ErrNotGenesisOp
	}
	hash := sha256.Sum256(op.SignedCBORBytes())
	suffix := base32.StdEncoding.EncodeToString(hash[:])[:24]
	return "did:plc:" + strings.ToLower(suffix), nil
}

func signOp(op Operation, priv crypto.PrivateKey) (string, error) {
	b := op.UnsignedCBORBytes()
	sig, err := priv.HashAndSign(b)
	if err != nil {
		return "", err
	}
	b64 := base64.RawURLEncoding.EncodeToString(sig)
	return b64, nil
}

func (op *RegularOp) Sign(priv crypto.PrivateKey) error {
	sig, err := signOp(op, priv)
	if err != nil {
		return err
	}
	op.Sig = &sig
	return nil
}

func verifySigOp(op Operation, pub crypto.PublicKey, sig *string) error {
	if sig == nil || *sig == "" {
		return fmt.Errorf("can't verify empty signature")
	}
	b := op.UnsignedCBORBytes()
	sigBytes, err := base64.RawURLEncoding.DecodeString(*sig)
	if err != nil {
		return err
	}
	return pub.HashAndVerify(b, sigBytes)
}

// parsing errors are not ignored (will be returned immediately if found)
func VerifySignatureAny(op Operation, didKeys []string) error {
	if len(didKeys) == 0 {
		return fmt.Errorf("no keys to verify against")
	}
	for _, dk := range didKeys {
		pub, err := crypto.ParsePublicDIDKey(dk)
		if err != nil {
			return err
		}
		err = op.VerifySignature(pub)
		if err != crypto.ErrInvalidSignature {
			return err
		}
		if nil == err {
			return nil
		}
	}
	return crypto.ErrInvalidSignature
}

func (op *RegularOp) VerifySignature(pub crypto.PublicKey) error {
	return verifySigOp(op, pub, op.Sig)
}

func (op *RegularOp) Doc(did string) (Doc, error) {
	svc := []DocService{}
	for key, s := range op.Services {
		svc = append(svc, DocService{
			ID:              did + "#" + key,
			Type:            s.Type,
			ServiceEndpoint: s.Endpoint,
		})
	}
	vm := []DocVerificationMethod{}
	for name, didKey := range op.VerificationMethods {
		pub, err := crypto.ParsePublicDIDKey(didKey)
		if err != nil {
			return Doc{}, err
		}
		vm = append(vm, DocVerificationMethod{
			ID:                 did + "#" + name,
			Type:               "Multikey",
			Controller:         did,
			PublicKeyMultibase: pub.Multibase(),
		})
	}
	doc := Doc{
		ID:                 did,
		AlsoKnownAs:        op.AlsoKnownAs,
		VerificationMethod: vm,
		Service:            svc,
	}
	return doc, nil
}

func (op *LegacyOp) CID() cid.Cid {
	return computeCID(op.SignedCBORBytes())
}

func (op *LegacyOp) UnsignedCBORBytes() []byte {
	unsigned := LegacyOp{
		Type:        op.Type,
		SigningKey:  op.SigningKey,
		RecoveryKey: op.RecoveryKey,
		Handle:      op.Handle,
		Service:     op.Service,
		Prev:        op.Prev,
		Sig:         nil,
	}
	out, err := cbor.DumpObject(unsigned)
	if err != nil {
		return nil
	}
	return out
}

func (op *LegacyOp) SignedCBORBytes() []byte {
	out, err := cbor.DumpObject(op)
	if err != nil {
		return nil
	}
	return out
}

func (op *LegacyOp) IsGenesis() bool {
	return op.Prev == nil
}

func (op *LegacyOp) IsSigned() bool {
	return op.Sig != nil && *op.Sig != ""
}

func (op *LegacyOp) DID() (string, error) {
	if !op.IsGenesis() {
		return "", ErrNotGenesisOp
	}
	hash := sha256.Sum256(op.SignedCBORBytes())
	suffix := base32.StdEncoding.EncodeToString(hash[:])[:24]
	return "did:plc:" + strings.ToLower(suffix), nil
}

func (op *LegacyOp) Sign(priv crypto.PrivateKey) error {
	sig, err := signOp(op, priv)
	if err != nil {
		return err
	}
	op.Sig = &sig
	return nil
}

func (op *LegacyOp) VerifySignature(pub crypto.PublicKey) error {
	return verifySigOp(op, pub, op.Sig)
}

func (op *LegacyOp) Doc(did string) (Doc, error) {
	// NOTE: could re-implement this by calling op.RegularOp().Doc()
	svc := []DocService{
		DocService{
			ID:              did + "#atproto_pds",
			Type:            "AtprotoPersonalDataServer",
			ServiceEndpoint: op.Service,
		},
	}
	vm := []DocVerificationMethod{
		DocVerificationMethod{
			ID:                 did + "#atproto",
			Type:               "Multikey",
			Controller:         did,
			PublicKeyMultibase: strings.TrimPrefix(op.SigningKey, "did:key:"),
		},
	}
	doc := Doc{
		ID:                 did,
		AlsoKnownAs:        []string{"at://" + op.Handle},
		VerificationMethod: vm,
		Service:            svc,
	}
	return doc, nil
}

// converts a legacy "create" op to an (unsigned) "plc_operation"
func (op *LegacyOp) RegularOp() RegularOp {
	return RegularOp{
		RotationKeys: []string{op.RecoveryKey},
		VerificationMethods: map[string]string{
			"atproto": op.SigningKey,
		},
		AlsoKnownAs: []string{"at://" + op.Handle},
		Services: map[string]OpService{
			"atproto_pds": OpService{
				Type:     "AtprotoPersonalDataServer",
				Endpoint: op.Service,
			},
		},
		Prev: nil, // always a create
		Sig:  nil, // don't have private key
	}
}

func (op *TombstoneOp) CID() cid.Cid {
	return computeCID(op.SignedCBORBytes())
}

func (op *TombstoneOp) UnsignedCBORBytes() []byte {
	unsigned := TombstoneOp{
		Type: op.Type,
		Prev: op.Prev,
		Sig:  nil,
	}
	out, err := cbor.DumpObject(unsigned)
	if err != nil {
		return nil
	}
	return out
}

func (op *TombstoneOp) SignedCBORBytes() []byte {
	out, err := cbor.DumpObject(op)
	if err != nil {
		return nil
	}
	return out
}

func (op *TombstoneOp) IsGenesis() bool {
	return false
}

func (op *TombstoneOp) IsSigned() bool {
	return op.Sig != nil && *op.Sig != ""
}

func (op *TombstoneOp) DID() (string, error) {
	return "", ErrNotGenesisOp
}

func (op *TombstoneOp) Sign(priv crypto.PrivateKey) error {
	sig, err := signOp(op, priv)
	if err != nil {
		return err
	}
	op.Sig = &sig
	return nil
}

func (op *TombstoneOp) VerifySignature(pub crypto.PublicKey) error {
	return verifySigOp(op, pub, op.Sig)
}

func (op *TombstoneOp) Doc(did string) (Doc, error) {
	return Doc{}, fmt.Errorf("tombstones do not have a DID document representation")
}

func (o *OpEnum) MarshalJSON() ([]byte, error) {
	if o.Regular != nil {
		return json.Marshal(o.Regular)
	} else if o.Legacy != nil {
		return json.Marshal(o.Legacy)
	} else if o.Tombstone != nil {
		return json.Marshal(o.Tombstone)
	}
	return nil, fmt.Errorf("can't marshal empty OpEnum")
}

func (o *OpEnum) UnmarshalJSON(b []byte) error {
	var typeMap map[string]interface{}
	err := json.Unmarshal(b, &typeMap)
	if err != nil {
		return err
	}
	typ, ok := typeMap["type"]
	if !ok {
		return fmt.Errorf("did not find expected operation 'type' field")
	}

	switch typ {
	case "plc_operation":
		o.Regular = &RegularOp{}
		return json.Unmarshal(b, o.Regular)
	case "create":
		o.Legacy = &LegacyOp{}
		return json.Unmarshal(b, o.Legacy)
	case "plc_tombstone":
		o.Tombstone = &TombstoneOp{}
		return json.Unmarshal(b, o.Tombstone)
	default:
		return fmt.Errorf("unexpected operation type: %s", typ)
	}
}

// returns a new signed PLC operation using the provided atproto-specific metdata
func NewAtproto(priv crypto.PrivateKey, handle string, pdsEndpoint string, rotationKeys []string) (RegularOp, error) {

	pub, err := priv.PublicKey()
	if err != nil {
		return RegularOp{}, err
	}
	if len(rotationKeys) == 0 {
		return RegularOp{}, fmt.Errorf("at least one rotation key is required")
	}
	handleURI := "at://" + handle
	op := RegularOp{
		RotationKeys: rotationKeys,
		VerificationMethods: map[string]string{
			"atproto": pub.DIDKey(),
		},
		AlsoKnownAs: []string{handleURI},
		Services: map[string]OpService{
			"atproto_pds": OpService{
				Type:     "AtprotoPersonalDataServer",
				Endpoint: pdsEndpoint,
			},
		},
		Prev: nil,
		Sig:  nil,
	}
	if err := op.Sign(priv); err != nil {
		return RegularOp{}, err
	}
	return op, nil
}

func (oe *OpEnum) AsOperation() Operation {
	if oe.Regular != nil {
		return oe.Regular
	} else if oe.Legacy != nil {
		return oe.Legacy
	} else if oe.Tombstone != nil {
		return oe.Tombstone
	} else {
		// TODO; something more safe here?
		return nil
	}
}
