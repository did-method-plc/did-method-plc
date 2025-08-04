import { P256Keypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'
import { CloseFn, runTestServer } from './_util'
import { check } from '@atproto/common'
import { Database } from '../src'
import { didForCreateOp, PlcClientError } from '@did-plc/lib'

describe('PLC server', () => {
  let handle1 = 'at://alice.example.com'
  let handle2 = 'at://bob.example.com'
  let atpPds = 'https://example.com'

  let close: CloseFn
  let db: Database
  let client: plc.Client

  let signingKey: P256Keypair
  let rotationKey1: P256Keypair
  let rotationKey2: P256Keypair
  let rotationKey3: P256Keypair

  let did1: string
  let did2: string

  beforeAll(async () => {
    const server = await runTestServer({
      dbSchema: 'server',
    })

    db = server.db
    close = server.close
    client = new plc.Client(server.url)
    signingKey = await P256Keypair.create()
    rotationKey1 = await P256Keypair.create()
    rotationKey2 = await P256Keypair.create()
    rotationKey3 = await P256Keypair.create()
  })

  afterAll(async () => {
    if (close) {
      await close()
    }
  })

  const verifyDoc = (doc: plc.DocumentData | null) => {
    if (!doc) {
      throw new Error('expected doc')
    }
    expect(doc.did).toEqual(did1)
    expect(doc.verificationMethods).toEqual({ atproto: signingKey.did() })
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.alsoKnownAs).toEqual([handle1])
    expect(doc.services).toEqual({
      atproto_pds: {
        type: 'AtprotoPersonalDataServer',
        endpoint: atpPds,
      },
    })
  }

  it('registers a did', async () => {
    did1 = await client.createDid({
      signingKey: signingKey.did(),
      rotationKeys: [rotationKey1.did(), rotationKey2.did()],
      handle: handle1,
      pds: atpPds,
      signer: rotationKey1,
    })

    did2 = await client.createDid({
      signingKey: signingKey.did(),
      rotationKeys: [rotationKey3.did()],
      handle: handle2,
      pds: atpPds,
      signer: rotationKey3,
    })
  })

  it('retrieves did doc data', async () => {
    const doc = await client.getDocumentData(did1)
    verifyDoc(doc)
  })

  it('can perform some updates', async () => {
    const newRotationKey = await P256Keypair.create()
    signingKey = await P256Keypair.create()
    handle1 = 'at://ali.example2.com'
    atpPds = 'https://example2.com'

    await client.updateAtprotoKey(did1, rotationKey1, signingKey.did())
    await client.updateRotationKeys(did1, rotationKey1, [
      newRotationKey.did(),
      rotationKey2.did(),
    ])
    rotationKey1 = newRotationKey

    await client.updateHandle(did1, rotationKey1, handle1)
    await client.updatePds(did1, rotationKey1, atpPds)

    const doc = await client.getDocumentData(did1)
    verifyDoc(doc)
  })

  it('does not allow *rotation* key types that we do not yet support', async () => {
    // an ed25519 key, which we don't yet support
    const newRotationKey =
      'did:key:z6MkjwbBXZnFqL8su24wGL2Fdjti6GSLv9SWdYGswfazUPm9'

    const promise = client.updateRotationKeys(did2, rotationKey3, [
      rotationKey2.did(),
      newRotationKey,
    ])
    await expect(promise).rejects.toThrow(PlcClientError)
  })

  it('allows *verificationMethod* key types that we do not explicitly support', async () => {
    // an ed25519 key, which we don't explicitly support
    const newSigningKey =
      'did:key:z6MkjwbBXZnFqL8su24wGL2Fdjti6GSLv9SWdYGswfazUPm9'

    // Note: atproto itself does not currently support ed25519 keys, but PLC
    // does not have opinions about atproto (or other services!)
    await client.updateAtprotoKey(did2, rotationKey3, newSigningKey)

    // a BLS12-381 key
    const exoticSigningKeyFromTheFuture =
      'did:key:zUC7K4ndUaGZgV7Cp2yJy6JtMoUHY6u7tkcSYUvPrEidqBmLCTLmi6d5WvwnUqejscAkERJ3bfjEiSYtdPkRSE8kSa11hFBr4sTgnbZ95SJj19PN2jdvJjyzpSZgxkyyxNnBNnY'
    await client.updateAtprotoKey(
      did2,
      rotationKey3,
      exoticSigningKeyFromTheFuture,
    )

    // check that we can still read back the rendered did document
    const doc = await client.getDocument(did2)
    expect(doc.verificationMethod).toEqual([
      {
        id: did2 + '#atproto',
        type: 'Multikey',
        controller: did2,
        publicKeyMultibase: exoticSigningKeyFromTheFuture.slice(8),
      },
    ])
  })

  it('does not allow syntactically invalid verificationMethod keys', async () => {
    const promise1 = client.updateAtprotoKey(
      did2,
      rotationKey3,
      'did:key:BJV2WY5DJMJQXGZJANFZSAYLXMVZW63LFEEQFY3ZP', // not b58 (b32!)
    )
    await expect(promise1).rejects.toThrow(PlcClientError)
    const promise2 = client.updateAtprotoKey(
      did2,
      rotationKey3,
      'did:banana', // a malformed did:key
    )
    await expect(promise2).rejects.toThrow(PlcClientError)
    const promise3 = client.updateAtprotoKey(
      did2,
      rotationKey3,
      'blah', // an even more malformed did:key
    )
    await expect(promise3).rejects.toThrow(PlcClientError)
  })

  it('does not allow unreasonably long verificationMethod keys', async () => {
    const promise = client.updateAtprotoKey(
      did2,
      rotationKey3,
      'did:key:z41vu8qtWtp8XRJ9Te5QhkyzU9ByBbiw7bZHKXDjZ8iYorixqZQmEZpxgVSteYirYWMBjqQuEbMYTDsCzXXCAanCSH2xG2cwpbCWGZ2coY2PnhbrDVo7QghsAHpm2X5zsRRwDLyUcm9MTNQAZuRs2B22ygQw3UwkKLA7PZ9ZQ9wMHppmkoaBapmUGaxRNjp1Mt4zxrm9RbEx8FiK3ANBL1fsjggNqvkKpbj6MjntRScPQnJCes9Vt1cFe3iwNP7Ya9RfbaKsVi1eothvSBcbWoouHActGeakHgqFLj1JpbkP7PL3hGGSWLQbXxzmdrfzBCYAtiUxGRvpf3JiaNA2WYbJTh58bzx',
    )
    await expect(promise).rejects.toThrow(PlcClientError)
  })

  it('retrieves the operation log', async () => {
    const doc = await client.getDocumentData(did1)
    const ops = await client.getOperationLog(did1)
    const computedDoc = await plc.validateOperationLog(did1, ops)
    expect(computedDoc).toEqual(doc)
  })

  it('rejects on bad updates', async () => {
    const newKey = await P256Keypair.create()
    const operation = client.updateAtprotoKey(did1, newKey, newKey.did())
    await expect(operation).rejects.toThrow()
  })

  it('allows for recovery through a forked history', async () => {
    const attackerKey = await P256Keypair.create()
    await client.updateRotationKeys(did1, rotationKey2, [attackerKey.did()])

    const newKey = await P256Keypair.create()
    const ops = await client.getOperationLog(did1)
    const forkPoint = ops.at(-2)
    if (!check.is(forkPoint, plc.def.operation)) {
      throw new Error('Could not find fork point')
    }
    const op = await plc.updateRotationKeysOp(forkPoint, rotationKey1, [
      rotationKey1.did(),
      newKey.did(),
    ])
    await client.sendOperation(did1, op)

    rotationKey2 = newKey

    const doc = await client.getDocumentData(did1)
    verifyDoc(doc)
  })

  it('retrieves the auditable operation log', async () => {
    const log = await client.getOperationLog(did1)
    const auditable = await client.getAuditableLog(did1)
    // has one nullifed op
    expect(auditable.length).toBe(log.length + 1)
    expect(auditable.filter((op) => op.nullified).length).toBe(1)
    expect(auditable.at(-2)?.nullified).toBe(true)
    expect(
      auditable.every((op) => check.is(op, plc.def.exportedOp)),
    ).toBeTruthy()
  })

  it('retrieves the did doc', async () => {
    const data = await client.getDocumentData(did1)
    const doc = await client.getDocument(did1)
    expect(doc).toEqual(plc.formatDidDoc(data))
  })

  it('handles concurrent requests to many docs', async () => {
    const COUNT = 20
    const keys: P256Keypair[] = []
    for (let i = 0; i < COUNT; i++) {
      keys.push(await P256Keypair.create())
    }
    await Promise.all(
      keys.map(async (key, index) => {
        await client.createDid({
          signingKey: key.did(),
          rotationKeys: [key.did()],
          handle: `user${index}`,
          pds: `example.com`,
          signer: key,
        })
      }),
    )
  })

  it('resolves races into a coherent history with no forks', async () => {
    const COUNT = 20
    const keys: P256Keypair[] = []
    for (let i = 0; i < COUNT; i++) {
      keys.push(await P256Keypair.create())
    }
    // const prev = await client.getPrev(did)

    let successes = 0
    let failures = 0
    await Promise.all(
      keys.map(async (key) => {
        try {
          await client.updateAtprotoKey(did1, rotationKey1, key.did())
          successes++
        } catch (err) {
          failures++
        }
      }),
    )
    expect(successes).toBe(1)
    expect(failures).toBe(19)

    const ops = await client.getOperationLog(did1)
    await plc.validateOperationLog(did1, ops)
  })

  it('tombstones the did', async () => {
    await client.tombstone(did1, rotationKey1)

    const promise = client.getDocument(did1)
    await expect(promise).rejects.toThrow(PlcClientError)
    const promise2 = client.getDocumentData(did1)
    await expect(promise2).rejects.toThrow(PlcClientError)
  })

  it('exports the data set', async () => {
    const data = await client.export()
    expect(data.every((row) => check.is(row, plc.def.exportedOp))).toBeTruthy()
    // the tests in this file produce 32 log entries, but other tests may be running
    expect(data.length).toBeGreaterThanOrEqual(32)
    for (let i = 1; i < data.length; i++) {
      expect(data[i].createdAt >= data[i - 1].createdAt).toBeTruthy()
    }
  })

  it('disallows create v1s', async () => {
    const createV1 = await plc.deprecatedSignCreate(
      {
        type: 'create',
        signingKey: signingKey.did(),
        recoveryKey: rotationKey1.did(),
        handle: handle1,
        service: atpPds,
        prev: null,
      },
      signingKey,
    )
    const did = await didForCreateOp(createV1)
    const attempt = client.sendOperation(did, createV1 as any)
    await expect(attempt).rejects.toThrow()
  })

  it('healthcheck succeeds when database is available.', async () => {
    const res = await client.health()
    expect(res).toEqual({ version: '0.0.0' })
  })

  it('healthcheck fails when database is unavailable.', async () => {
    await db.db.destroy()
    let error: PlcClientError
    try {
      await client.health()
      throw new Error('Healthcheck should have failed')
    } catch (err) {
      if (err instanceof PlcClientError) {
        error = err
      } else {
        throw err
      }
    }
    expect(error.status).toEqual(503)
    expect(error.data).toEqual({
      version: '0.0.0',
      error: 'Service Unavailable',
    })
  })
})
