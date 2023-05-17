# DID Placeholder (did:plc)

DID Placeholder is a cryptographic, strongly-consistent, and recoverable [DID](https://www.w3.org/TR/did-core/) method.

## Motivation

We introduced DID Placeholder because we weren't totally satisfied with any of the existing DID methods.
We wanted a strongly consistent, highly available, recoverable, and cryptographically secure method with cheap and fast propagation of updates.

We titled the method "Placeholder", because we _don't_ want it to stick around in its current form. We're actively hoping to replace it with or evolve it into something less centralized - likely a permissioned DID consortium.

## How it works
Each DID document can be described by a JSON object of the following format:
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

Keys are notated using [did:key](https://w3c-ccg.github.io/did-method-key/) and only secp256k1 and NIST P-256 are currently supported.

This data is a succinct format that can be directly translated to a valid DID document.

Each operation fully attests the current state of the document data. It also includes a reference to the previous operation in the log using a sha256 [CID](https://github.com/multiformats/cid). Each operation also includes a `base64url` encoded signature of the cbor-encoded operation from a valid rotation key.

An operation is of the shape:
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

The DID itself is derived from the sha256 hash of the first operation in the log. It is then base32 encoded and truncated to 24 chars.

To illustrate: 
`did:plc:${base32Encode(sha256(createOp)).slice(0,24)}`

Operations are verified, ordered and made available by the PLC server.

The operation logs are fully self-certifying, with the exception of their ordering.

Therefore, the PLC server's attacks are limited to:
- Denial of service: rejecting valid operations, or refusing to serve some information about the DID
- Misordering: In the event of a fork in DID document history, the server could choose to serve the "wrong" fork

### DID Rotation & Account Recovery

Any key specified in `rotationKeys` has the ability to sign operations for the DID document.

These keys are solely a PLC concept and are _not_ included in the DID document.

Keys are listed in the document data in order of descending authority. 

The PLC server provides a 72hr window during which a higher authority key can "rewrite" history.

To do so, that key must sign a new operation that points to the CID of the last "valid" operation - ie the fork point. This operation will be accepted as long as it was within 72hrs of the pointed to operation & the key that signed it is at a lower index in the `rotationKeys` array than the key that signed the to-be-invalidated operation


### Resolution

Dids are resolved by making a GET request to `https://plc.directory/:did`

In addition, you may resolve the constituent data by making a request to `https://plc.directory/:did/data`

### Auditability

As an additional check against the PLC server and to promote resiliency, the entire database of PLC is auditable.

The audit history of a given DID (complete with timestamps & invalidated forked histories) can be found at: `https://plc.directory/:did/log/audit`

The entire history of PLC operations may be downloaded as a paginated series of jsonlines at `https://plc.directory/export`

## Example

```ts
// note: we use shorthand for keys for ease of reference, but consider them valid did:keys

// Genesis operation
const genesisOp = {
  type: 'plc_operation',
  verificationMethods: {
    atproto:"did:key:zSigningKey"
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
    atproto:"did:key:zSigningKey"
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
    atproto:"did:key:zAttackerKey"
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
    atproto:"did:key:zSigningKey"
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
