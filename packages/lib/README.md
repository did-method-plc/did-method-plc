@did-plc/lib - DID PLC Typescript Client Library
================================================

[![NPM](https://img.shields.io/npm/v/@did-plc/lib)](https://www.npmjs.com/package/@did-plc/lib)
[![Github CI Status](https://github.com/did-method-plc/did-method-plc/actions/workflows/build-test-verify.yaml/badge.svg)](https://github.com/did-method-plc/did-method-plc/actions/workflows/build-test-verify.yaml)

This library provides both a simple client for the PLC directory, and an implementation of the PLC method itself (using a cryptographically signed operation log).

## Client Usage

Fetching account data from directory:

```typescript
import * as plc from '@did-plc/lib'

client = new plc.Client('https://plc.directory')

let exampleDid = 'did:plc:yk4dd2qkboz2yv6tpubpc6co'

// current account data, in terse object format
const data = await client.getDocumentData(exampleDid)

// or, the full DID Document
const didDoc = await client.getDocument(exampleDid)
```

Registering a new DID PLC:

```typescript
import { Secp256k1Keypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'

// please test against a sandbox or local development server
client = new plc.Client('http://localhost:2582')

let signingKey = await Secp256k1Keypair.create()
let rotationKey = await Secp256k1Keypair.create()

did = await client.createDid({
  signingKey: signingKey.did(),
  handle: 'handle.example.com',
  pds: 'https://pds.example.com',
  rotationKeys: [rotationKey.did()],
  signer: rotationKey,
})
```

Custom fetch:

```typescript
// any fetch implementation, e.g. one that adds timeouts or tracing
client = new plc.Client('https://plc.directory', { fetch: myFetch })
```

If no `fetch` is given, the global `fetch` is used.

### Errors

- A non-2xx response rejects with `PlcClientError`, which has `status`, `headers`, and `data`. A 409 is a `PlcConflictError`; a 412 is a `PlcPrevMismatchError`.
- Network failures reject with the error from `fetch` itself (usually a `TypeError`).
- Calls made with `{ signal }` reject with the signal's reason when aborted.

## License

MIT / Apache 2.0 dual-licensed.
