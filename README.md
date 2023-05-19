# DID Placeholder Method (did:plc)

DID Placeholder is a cryptographic, strongly-consistent, and recoverable [DID](https://www.w3.org/TR/did-core/) method.

Control over a `did:plc` identity rests in configurable keys pairs. These keys can sign update "operations" to mutate the identity (including key rotation), with each operation referencing a prior version of the identity state. A central server collects and validates operations, and maintains a transparent log of operations for each DID. Each identity starts from an initial "genesis" operation, and the hash of this initial object is what defines the DID itself (that is, the DID URI "identifier" string).

## Motivation

We introduced DID Placeholder when designing the AT Protocol ("atproto") because we were not satisfied with any of the existing DID methods.
We wanted a strongly consistent, highly available, recoverable, and cryptographically secure method with fast and cheap propagation of updates.

We titled the method "Placeholder", because we _don't_ want it to stick around forever in its current form. We are actively hoping to replace it with or evolve it into something less centralized - likely a permissioned DID consortium.

## How it works

The core information required to render a `did:plc` DID document is summarized by a JSON object with the following format:

```ts
type DocumentData = {
  did: string
  rotationKeys: string[]
  verificationMethods: Record<string, string>
  alsoKnownAs: string[]
  services: Record<string, Service>
}

type Service = {
  type: string
  endpoint: string
}
```

The keys specified in the `verificationMethods` object are the "signing keys" used in atproto. The "rotation keys" are used only for control of the DID identity itself. It is permitted to include a key as both a rotation key and a signing key.

An "operation" object has the following format:

```ts
type Operation = {
  type: 'plc_operation',
  rotationKeys: string[]
  verificationMethods: Record<string, string>
  alsoKnownAs: string[]
  services: Record<string, Service>
  prev: CID | null // null if genesis operation
  sig: string
}
```

Each operation fully attests the current state of the document data. It also includes a content reference (hash) to the previous operation in the log, and is signed by a valid rotation key.

The process for signing and hashing operation objects is to first encode them in the DAG-CBOR binary serialization format. [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) is a restricted subset of the Concise Binary Object Representation (CBOR), an IETF standard (RFC 8949), with semantics and value types similar to JSON.

For signatures, the DAG-CBOR bytes are signed, and then the signature bytes are encoded in to a string using `base64url` encoding.

For `prev` references, the SHA-256 of the previous operation's bytes are encoded as a "[CID](https://github.com/multiformats/cid)", using the relevant multibase code (for `dag-cbor`), and CIDv1 format.

Rotation keys are serialized as strings using [did:key](https://w3c-ccg.github.io/did-method-key/), and only `secp256k1` ("k256") and NIST P-256 ("p256") are currently supported.

The signing keys (`verificationMethods`) are represented as objects, with the actual keys in multibase encoding, as required by the DID Core specification.

The DID itself is derived from the hash of the first operation in the log, call the "genesis" operation. The object is encoded an DAG-CBOR; the bytes are hashed with SHA-256; the hash bytes are `base32`-encoded (not hex encoded) as a string; and that string is truncated to 24 chars to yield the "identifier" segment of the DID.

In pseudo-code: 
`did:plc:${base32Encode(sha256(createOp)).slice(0,24)}`


### DID Rotation & Account Recovery

Any key specified in `rotationKeys` has the ability to sign operations for the DID document.

The set of rotation keys for a DID is not included in the DID document. They are an internal detail of PLC, and are stored in the operation log.

Keys are listed in the `rotationKeys` field of operations in order of descending authority. 

The PLC server provides a 72hr window during which a higher authority rotation key can "rewrite" history, clobbering any operations (or chain of operations) signed by a lower-authority rotation key.

To do so, that key must sign a new operation that points to the CID of the last "valid" operation - ie the fork point.
The PLC server will accept this recovery operation as long as:

- it is submitted within 72hrs of the referenced operation
- the key used for the signature has a lower index in the `rotationKeys` array than the key that signed the to-be-invalidated operation


### PLC Server Trust Model

The PLC server has a public endpoint to receive operation objects from any client (without authentication). The server verifies operations, orders them according to recovery rules, and makes the log of operations publicly available.

The operation log is self-certifying, and contains all the information needed to construct (or verify) the the current state of the DID document.

Some trust is required in the PLC server. It's attacks are limited to:

- Denial of service: rejecting valid operations, or refusing to serve some information about the DID
- Misordering: In the event of a fork in DID document history, the server could choose to serve the "wrong" fork


### DID Resolution

PLC DIDs are resolved by making a GET request to the PLC server. The default resulution endpoint is: `https://plc.directory/:did`

In addition, you can fetch the constituent data by making a request to: `https://plc.directory/:did/data`


### Auditability

As an additional check against the PLC server, and to promote resiliency, the entire operation log is auditable.

The audit history of a given DID (complete with timestamps & invalidated forked histories) can be found at: `https://plc.directory/:did/log/audit`

The entire history of PLC operations may be downloaded as a paginated series of JSON lines: `https://plc.directory/export`

## Example

```ts
// note: we use shorthand for keys for ease of reference, but consider them valid did:keys

// Genesis operation
const genesisOp = {
  type: 'plc_operation',
  verificationMethods: {
    atproto: "did:key:zSigningKey"
  },
  rotationKeys: [
    "did:key:zRecoveryKey",
    "did:key:zRotationKey"
  ],
  alsoKnownAs: [
    "at://alice.test"
  ],
  services: {
    atproto_pds: {
      type: "AtprotoPersonalDataServer",
      endpoint: "https://example.test"
    }
  },
  prev: null,
  sig: 'sig_from_did:key:zRotationKey'
}

// Operation to update recovery key
const updateKeys = {
  type: 'plc_operation',
  verificationMethods: {
    atproto: "did:key:zSigningKey"
  },
  rotationKeys: [
    "did:key:zNewRecoveryKey",
    "did:key:zRotationKey"
  ],
  alsoKnownAs: [
    "at://alice.test"
  ],
  services: {
    atproto_pds: {
      type: "AtprotoPersonalDataServer",
      endpoint: "https://example.test"
    }
  },
  prev: CID(genesisOp),
  sig: 'sig_from_did:key:zRotationKey'
}

// Invalid operation that will be rejected
// because did:key:zAttackerKey is not listed in rotationKeys
const invalidUpdate = {
  type: 'plc_operation',
  verificationMethods: {
    atproto: "did:key:zAttackerKey"
  },
  rotationKeys: [
    "did:key:zAttackerKey"
  ],
  alsoKnownAs: [
    "at://bob.test"
  ],
  services: {
    atproto_pds: {
      type: "AtprotoPersonalDataServer",
      endpoint: "https://example.test"
    }
  },
  prev: CID(updateKeys),
  sig: 'sig_from_did:key:zAttackerKey'
}

// Valid recovery operation that "undoes" updateKeys
const recoveryOp = {
  type: 'plc_operation',
  verificationMethods: {
    atproto: "did:key:zSigningKey"
  },
  rotationKeys: [
    "did:key:zRecoveryKey"
  ],
  alsoKnownAs: [
    "at://alice.test"
  ],
  services: {
    atproto_pds: {
      type: "AtprotoPersonalDataServer",
      endpoint: "https://example.test"
    }
  },
  prev: CID(genesisOp),
  sig: 'sig_from_did:key:zRecoveryKey'
}
```

## Presentation as DID Document 

The following data:

```ts
{
  did: 'did:plc:7iza6de2dwap2sbkpav7c6c6',
  verificationMethods: {
    atproto: 'did:key:zDnaeh9v2RmcMo13Du2d6pjUf5bZwtauYxj3n9dYjw4EZUAR7'
  },
  rotationKeys: [
    'did:key:zDnaedvvAsDE6H3BDdBejpx9ve2Tz95cymyCAKF66JbyMh1Lt',
    'did:key:zDnaeh9v2RmcMo13Du2d6pjUf5bZwtauYxj3n9dYjw4EZUAR7'
  ],
  alsoKnownAs: [
    'at://alice.test'
  ],
  services: {
    atproto_pds: {
      type: "AtprotoPersonalDataServer",
      endpoint: "https://example.test"
    }
  }
}
```

Will be presented as the following DID document:

```ts
{
  '@context': [
    'https://www.w3.org/ns/did/v1',
    'https://w3id.org/security/suites/ecdsa-2019/v1'
  ],
  id: 'did:plc:7iza6de2dwap2sbkpav7c6c6',
  alsoKnownAs: [ 'at://alice.test' ],
  verificationMethod: [
    {
      id: '#atproto',
      type: 'EcdsaSecp256r1VerificationKey2019',
      controller: 'did:plc:7iza6de2dwap2sbkpav7c6c6',
      publicKeyMultibase: 'zSSa7w8s5aApu6td45gWTAAFkqCnaWY6ZsJ8DpyzDdYmVy4fARKqbn5F1UYBUMeVvYTBsoSoLvZnPdjd3pVHbmAHP'
    }
  ],
  service: [
    {
      id: '#atproto_pds',
      type: 'AtprotoPersonalDataServer',
      serviceEndpoint: 'https://example2.com'
    }
  ]
}
```

## Possible Future Changes

The set of allowed ("blessed") public key cryptographic curves may expanded over time, slowly.

Support for "DID Controllers" might be useful in the context of atproto.

Support for multiple "handles" for the same DID is being considered, but no final decision has been made yet.

We welcome proposals for small additions to make `did:plc` more generic and reusable for applications other than atproto. But no promises: atproto will remain the focus for the near future.

Moving governance of the `did:plc` method, and operation of registry servers, out of the sole control of Bluesky PBLLC is something we are enthusiastic about.

