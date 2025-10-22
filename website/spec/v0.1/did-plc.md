
# `did:plc` Method Specification

**Version:** v0.2.1 (October 2025)

DID PLC is a self-authenticating [DID](https://www.w3.org/TR/did-core/) which is strongly-consistent, recoverable, and allows for key rotation.

An example DID is: `did:plc:ewvi7nxzyoun6zhxrhs64oiz`

Control over a `did:plc` identity rests in a set of reconfigurable rotation keys pairs. These keys can sign update operations to mutate the identity (including key rotations), with each operation referencing a prior version of the identity state by hash. Each identity starts from an initial genesis operation, and the hash of this initial object is what defines the DID itself (that is, the DID URI identifier string). A central directory server collects and validates operations, and maintains a transparent log of operations for each DID.

## How it works

The metadata associated with an active `did:plc` identifier at any point in time is listed below. The encoding and structure differs somewhat from DID document formatting and semantics, but this information is sufficient to render a valid DID document.

- `did` (string): the full DID identifier
- `rotationKeys` (array of strings): priority-ordered list of public keys in `did:key` encoding. must include least 1 key and at most 5 keys, with no duplication. control of the DID identifier rests in these keys. not included in DID document.
- `verificationMethods` (map with string keys and values): maps services to public keys, stored in `did:key` encoding. The service id strings should not include a `#` prefix; that will be added when rendering the DID document. used to generate `verificationMethods` of DID document. these keys do not have control over the DID document.
- `alsoKnownAs` (array of strings): priority-ordered list of URIs which indicate other names or aliases associated with the DID identifier
- `services` (map with string keys; values are maps with `type` and `endpoint` string fields): a set of service / URL mappings. the key strings should not include a `#` prefix; that will be added when rendering the DID document.

Every update operation to the DID identifier, including the initial creation operation (the genesis operation), contains all of the above information, except for the `did` field. The DID itself is generated from a hash of the signed genesis operation (details described below), which makes the DID entirely self-certifying. Updates after initial creation contain a pointer to the most-recent previous operation (by hash).

Operations are signed and submitted to the central PLC directory server over an un-authenticated HTTP request. The PLC server validates operations against any and all existing operations on the DID (including signature validation, recovery time windows, etc), and either rejects the operation or accepts and permanently stores the operation, along with a server-generated timestamp.

A special operation type is a "tombstone", which clears all of the data fields and permanently deactivates the DID. Note that the usual recovery time window applies to tombstone operations.

Note that `rotationKeys` and `verificationMethods` (signing keys) may have public keys which are re-used across many accounts. There is not necessarily a one-to-one mapping between a DID and either rotation keys or signing keys.

Only `secp256k1` ("k256") and NIST P-256 ("p256") keys are currently supported for rotation keys, whereas `verificationMethods` keys can be any syntactically-valid `did:key`.

### Use with AT Protocol

The following information should be included for use with atproto:

- `verificationMethods`: an `atproto` entry with a "blessed" public key type, to be used as a signing key for authenticating updates to the account's repository. The signing key does not have any control over the DID identity unless also included in the `rotationKeys` list. Best practice is to maintain separation between rotation keys and atproto signing keys.
- `alsoKnownAs`: should include an `at://` URI indicating a handle (hostname) for the account. Note that the handle/DID mapping needs to be validated bi-directionally (via handle resolution), and needs to be re-verified periodically
- `services`: an `atproto_pds` entry with an `AtprotoPersonalDataServer` type and http/https URL `endpoint` indicating the account's current PDS hostname. for example, `https://pds.example.com` (no `/xrpc/` suffix needed).

### Operation Serialization, Signing, and Validation

There are a couple of variations on the operation data object schema. The operations are also serialized both as simple JSON objects, or binary DAG-CBOR encoding for the purpose of hashing or signing.

A regular creation or update operation contains the following fields:

- `type` (string): with fixed value `plc_operation`
- `rotationKeys` (array of strings): as described above
- `verificationMethods` (mapping of string keys and values): as described above
- `alsoKnownAs` (array of strings): as described above
- `services` (mapping of string keys and object values): as described above
- `prev` (string, nullable): a CID hash pointer to a previous operation of an update, or `null` for a creation. If `null`, the key should actually be part of the object, with value `null`, not simply omitted. In DAG-CBOR encoding, the CID is string-encoded, not a binary IPLD "Link"
- `sig` (string): signature of the operation in `base64url` encoding

A tombstone operation contains:

- `type` (string): with fixed value `plc_tombstone`
- `prev` (string): same as above, but not nullable
- `sig` (string): signature of the operation (same as above)

There is also a deprecated legacy operation format, supported *only* for creation ("genesis") operations:

- `type` (string): with fixed value `create`
- `signingKey` (string): single `did:key` value (not an array of strings)
- `recoveryKey` (string): single `did:key` value (not an array of strings); and note "recovery" terminology, not "rotation"
- `handle` (string): single value, indicating atproto handle, instead of `alsoKnownAs`. bare handle, with no `at://` prefix
- `service` (string): single value, http/https URL of atproto PDS
- `prev` (null): always include, but always with value `null`
- `sig` (string): signature of the operation (same as above)

Legacy `create` operations are stored in the PLC registry and may be returned in responses, so validating software needs to support that format. Conversion of the legacy format to "regular" operation format is relatively straight-forward, but there exist many `did:plc` identifiers where the DID identifier itself is based on the hash of the old format, so they will unfortunately be around forever.

The process for signing and hashing operation objects is to first encode them in the DAG-CBOR binary serialization format. [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) is a restricted subset of the Concise Binary Object Representation (CBOR), an IETF standard (RFC 8949), with semantics and value types similar to JSON.

As an anti-abuse mechanism, operations have a maximum size when encoded as DAG-CBOR. The current limit is 7500 bytes.

For signatures, the object is first encoded as DAG-CBOR *without* the `sig` field at all (as opposed to a `null` value in that field). Those bytes are signed using ECDSA-SHA256, and the signature value is encoded as follows:

1. The signature value is represented as a pair of integers `(r, s)`, as described in [RFC 4754](https://datatracker.ietf.org/doc/html/rfc4754#section-3)

2. The signature is canonicalized in "low-S" form. This means that if `s` is greater than or equal to half the EC group order constant, the value of `s` is replaced by `-s` (modulo the EC group order). This process is described for the secp256k1 curve as part of [Bitcoin BIP-0062](https://github.com/bitcoin/bips/blob/master/bip-0062.mediawiki), but this definition can be generalized to the NIST P-256 curve also.

3. The `(r, s)` tuple is encoded to bytes in the same format as specified in the [SubtleCrypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign#ecdsa) web API. This format is refered to by a variety of names, including "raw", "compact", "IEEE P1363". For secp256k1 and NIST P-256 curves, it is concretely: 32 big-endian bytes representing integer `r`, followed by 32 big-endian bytes representing integer `s`.

4. Those bytes are encoded as a string using `base64url` encoding, without equals-padding. Trailing padding bits MUST be set to zero, as described in [RFC 4648 section 3.5](https://www.rfc-editor.org/rfc/rfc4648.html#section-3.5)

When verifying signatures, the above encoding requirements must be enforced strictly, with non-canonical encodings or "High-S" values rejected as invalid. Otherwise, it would be possible for the signature encoding to be modified (thus modifying the operation's CID) without invalidating the signature.

For `prev` references, the SHA-256 of the previous operation's bytes are encoded as a "[CID](https://github.com/multiformats/cid)", with the following parameters:

- CIDv1
- `base32` multibase encoding (prefix: `b`)
- `dag-cbor` multibase type (code: 0x71)
- `sha-256` multihash (code: 0x12)

Rotation keys are serialized as strings using [did:key](https://w3c-ccg.github.io/did-key-spec/), and only `secp256k1` ("k256") and NIST P-256 ("p256") are currently supported.

The signing keys (`verificationMethods`) are also serialized using `did:key` in operations. When rendered in a DID document, signing keys are represented as objects, with the actual keys in multibase encoding, as required by the DID Core specification.

Although `verificationMethods` signing keys can be of any key type (unlike rotation keys), they must still be syntactically valid. i.e. They must have a `did:key:` prefix, followed by a `base58btc` multibase string.

The DID itself is derived from the hash of the first operation in the log, called the "genesis" operation. The signed operation is encoded in DAG-CBOR; the bytes are hashed with SHA-256; the hash bytes are `base32`-encoded (not hex encoded) as a string; and that string is truncated to 24 chars to yield the "identifier" segment of the DID.

In pseudo-code: 
`did:plc:${base32Encode(sha256(createOp)).slice(0,24)}`

### Identifier Syntax

The DID PLC method name is `plc`. The identifier part is 24 characters long, including only characters from the `base32` encoding set. An example is `did:plc:yk4dd2qkboz2yv6tpubpc6co`. This means:

- the overall identifier length is 32 characters
- the entire identifier is lower-case (and should be normalized to lower-case)
- the entire identifier is ASCII, and includes only the characters `a-z`, `0-9`, and `:` (and does not even use digits `0189`)


### Key Rotation & Account Recovery

Any key specified in `rotationKeys` has the ability to sign operations for the DID document.

The set of rotation keys for a DID is not included in the DID document. They are an internal detail of PLC, and are stored in the operation log.

Keys are listed in the `rotationKeys` field of operations in order of descending authority. 

The PLC server provides a 72hr window during which a higher authority rotation key can "rewrite" history, clobbering any operations (or chain of operations) signed by a lower-authority rotation key.

To do so, that key must sign a new operation that points to the CID of the last "valid" operation - ie the fork point.
The PLC server will accept this recovery operation as long as:

- it is submitted within 72hrs of the to-be-invalidated operation
- the key used for the signature has a lower index in the `rotationKeys` array than the key that signed the to-be-invalidated operation


### Privacy and Security Concerns

The full history of DID operations and updates, including timestamps, is permanently publicly accessible. This is true even after DID deactivation. It is important to recognize (and communicate to account holders) that any personally identifiable information (PII) encoded in `alsoKnownAs` URIs will be publicly visible even after DID deactivation, and can not be redacted or purged.

In the context of atproto, this includes the full history of handle updates and PDS locations (URLs) over time. To be explicit, it does not include any other account metadata such as email addresses or IP addresses. Handle history could potentially de-anonymize account holders if they switch handles between a known identity and an anonymous or pseudonymous identity.

The PLC server does not cross-validate `alsoKnownAs` or `service` entries in operations. This means that any DID can "claim" to have any identity, or to have an active account with any service (identified by URL). This data should *not* be trusted without bi-directionally verification, for example using handle resolution.

The timestamp metadata encoded in the PLC audit log could be cross-verified against network traffic or other information to de-anonymize account holders. It also makes the "identity creation date" public.

If "rotation" and "signing" keys are re-used across multiple accounts, it could reveal non-public identity details or relationships. For example, if two individuals cross-share rotation keys as a trusted backup, that information is public. If device-local recovery or signing keys are uniquely shared by two identifiers, that would indicate that those identities may actually be the same person.


#### PLC Server Trust Model

The PLC server has a public endpoint to receive operation objects from any client (without authentication). The server verifies operations, orders them according to recovery rules, and makes the log of operations publicly available.

The operation log is self-certifying, and contains all the information needed to construct (or verify) the the current state of the DID document.

Some trust is required in the PLC server. Its attacks are limited to:

- Denial of service: rejecting valid operations, or refusing to serve some information about the DID
- Misordering: In the event of a fork in DID document history, the server could choose to serve the "wrong" fork


### DID Creation

To summarize the process of creating a new `did:plc` identifier:

- collect values for the essential operation data fields, including generating new secure key pairs if necessary
- construct an "unsigned" regular operation object. include a `prev` field with `null` value. do not use the deprecated/legacy operation format for new DID creations
- serialize the "unsigned" operation with DAG-CBOR, and sign the resulting bytes with one of the initial `rotationKeys`. encode the signature as `base64url`, and use that to construct a "signed" operation object
- serialize the "signed" operation with DAG-CBOR, take the SHA-256 hash of those bytes, and encode the hash bytes in `base32`. use the first 24 characters to generate DID value (`did:plc:<hashchars>`)
- serialize the "signed" operation as simple JSON, and submit it via HTTP POST to `https://plc.directory/:did`
- if the HTTP status code is successful, the DID has been registered

When "signing" using a "`rotationKey`", what is meant is to sign using the private key associated the public key in the `rotationKey` list.

### DID Update

To summarize the process of updating a new `did:plc` identifier:

- if the current DID state isn't known, fetch the current state from `https://plc.directory/:did/data`
- if the most recent valid DID operation CID (hash) isn't known, fetch the audit log from `https://plc.directory/:did/log/audit`, identify the most recent valid operation, and get the `cid` value. if this is a recovery operation, the relevant "valid" operation to fork from may not be the most recent in the audit log
- collect updated values for the essential operation data fields, including generating new secure key pairs if necessary (eg, key rotation)
- construct an "unsigned" regular operation object. include a `prev` field with the CID (hash) of the previous valid operation
- serialize the "unsigned" operation with DAG-CBOR, and sign the resulting bytes with one of the previously-existing `rotationKeys`. encode the signature as `base64url`, and use that to construct a "signed" operation object
- serialize the "signed" operation as simple JSON, and submit it via HTTP POST to `https://plc.directory/:did`
- if the HTTP status code is successful, the DID has been updated
- the DID update may be nullified by a "rotation" operation during the recovery window (currently 72hr)

### DID Deactivation

To summarize the process of de-activating an existing `did:plc` identifier:

- if the most recent valid DID operation CID (hash) isn't known, fetch the audit log from `https://plc.directory/:did/log/audit`, identify the most recent valid operation, and get the `cid` value
- construct an "unsigned" tombstone operation object. include a `prev` field with the CID (hash) of the previous valid operation
- serialize the "unsigned" tombstone operation with DAG-CBOR, and sign the resulting bytes with one of the previously-existing `rotationKeys`. encode the signature as `base64url`, and use that to construct a "signed" tombstone operation object
- serialize the "signed" tombstone operation as simple JSON, and submit it via HTTP POST to `https://plc.directory/:did`
- if the HTTP status code is successful, the DID has been deactivated
- the DID deactivation may be nullified by a "rotation" operation during the recovery window (currently 72hr)

### DID Resolution

PLC DIDs are resolved to a DID document (JSON) by making simple HTTP GET request to the PLC server. The resolution endpoint is: `https://plc.directory/:did`

The PLC-specific state data (based on the most recent operation) can be fetched as a JSON object at: `https://plc.directory/:did/data`


### Audit Logs

As an additional check against abuse by the PLC server, and to promote resiliency, the set of all identifiers is enumerable, and the set of all operations for all identifiers (even "nullified" operations) can be enumerated and audited.

The log of currently-valid operations for a given DID, as JSON, can be found at: `https://plc.directory/:did/log/audit`

The audit history of a given DID (complete with timestamps and invalidated forked histories), as JSON, can be found at: `https://plc.directory/:did/log/audit`

To fully validate a DID document against the operation log:

- fetch the full audit log
- for the genesis operation, validate the DID
    - note that the genesis operation may be in deprecated/legacy format, and should be encoded and verified in that format
    - see the "DID Creation" section above for details
- for each operation in the log, validate signatures:
    - identify the set of valid `rotationKeys` at that point of time: either the initial keys for a "genesis" operation, or the keys in the `prev` operation
    - remove any `sig` field and serialize the "unsigned" operation with DAG-CBOR, yielding bytes
    - decode the `base64url` `sig` field to bytes
    - for each of the `rotationKeys`, attempt to verify the signature against the "unsigned" bytes
    - if no key matches, there has been a trust violation; the PLC server should never have accepted the operation
- verify the correctness of "nullified" operations and the current active operation log using the rules around rotation keys and recovery windows

The complete log of operations for all DIDs on the PLC server can be enumerated efficiently:

- HTTP endpoint: `https://plc.directory/export`
- output format: [JSON lines](https://jsonlines.org/)
- `count` query parameter, as an integer, maximum 1000 lines per request
- `after` query parameter, based on `createdAt` timestamp, for pagination


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

The set of allowed ("blessed") public key cryptographic algorithms (aka, curves) may expanded over time, slowly. Likewise, support for additional blessed CID types and parameters may be expanded over time, slowly.

The recovery time window may become configurable, within constraints, as part of the DID metadata itself.

Support for "DID Controller Delegation" could be useful (eg, in the context of atproto PDS hosts), and may be incorporated.

In the context of atproto, support for multiple handles for the same DID is being considered, with a single primary handle. But no final decision has been made yet.

We welcome proposals for small additions to make `did:plc` more generic and reusable for applications other than atproto. But no promises: atproto will remain the focus for the near future.

We are enthusiastic about the prospect of moving governance of the `did:plc` method, and operation of registry servers, out of the sole control of Bluesky Social PBC. Audit log snapshots, mirroring, and automated third-party auditing have all been considered as mechanisms to mitigate the centralized nature of the PLC server.

The size of the `verificationMethods`, `alsoKnownAs`, and `service` mappings/arrays may be specifically constrained. And the maximum DAG-CBOR size may be constrained.

As an anti-abuse mechanisms, the PLC server load balancer restricts the number of HTTP requests per time window. The limits are generous, and operating large services or scraping the operation log should not run into limits. Specific per-DID limits on operation rate may be introduced over time. For example, no more than N operations per DID per rotation key per 24 hour window.

A "DID PLC history explorer" web interface would make the public nature of the DID audit log more publicly understandable.

It is conceivable that longer DID PLCs, with more of the SHA-256 characters, will be supported in the future. It is also conceivable that a different hash algorithm would be allowed. Any such changes would allow existing DIDs in their existing syntax to continue being used.

## Changelog

### 2025-10-22 (v0.2.1)

This update makes no behavioural changes, only clarifications to the written specification.

- Clarify signature encoding rules.

- Clarify operation nullification time constraints.

- Remove some non-normative statements.

### 2025-06-05 (v0.2)

- `verificationMethods` keys may now use any syntactically-valid `did:key:`, regardless of key format (allowing e.g. `ed25519` keys). Rotation keys are not affected by this change, the original format constraints still apply.

- A total limit of 10 `verificationMethods` (per DID) has been added.
