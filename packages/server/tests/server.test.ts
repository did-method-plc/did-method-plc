import { EcdsaKeypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'
import { CloseFn, runTestServer } from './_util'
import { check } from '@atproto/common'
import { Database } from '../src'
import { didForCreateOp, PlcClientError } from '@did-plc/lib'

describe('PLC server', () => {
  let handle = 'at://alice.example.com'
  let atpPds = 'https://example.com'

  let close: CloseFn
  let db: Database
  let client: plc.Client

  let signingKey: EcdsaKeypair
  let rotationKey1: EcdsaKeypair
  let rotationKey2: EcdsaKeypair

  let did: string

  beforeAll(async () => {
    const server = await runTestServer({
      dbSchema: 'server',
    })

    db = server.db
    close = server.close
    client = new plc.Client(server.url)
    signingKey = await EcdsaKeypair.create()
    rotationKey1 = await EcdsaKeypair.create()
    rotationKey2 = await EcdsaKeypair.create()
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
    expect(doc.did).toEqual(did)
    expect(doc.verificationMethods).toEqual({ atproto: signingKey.did() })
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.alsoKnownAs).toEqual([handle])
    expect(doc.services).toEqual({
      atproto_pds: {
        type: 'AtprotoPersonalDataServer',
        endpoint: atpPds,
      },
    })
  }

  it('registers a did', async () => {
    did = await client.createDid({
      signingKey: signingKey.did(),
      rotationKeys: [rotationKey1.did(), rotationKey2.did()],
      handle,
      pds: atpPds,
      signer: rotationKey1,
    })
  })

  it('retrieves did doc data', async () => {
    const doc = await client.getDocumentData(did)
    verifyDoc(doc)
  })

  it('can perform some updates', async () => {
    const newRotationKey = await EcdsaKeypair.create()
    signingKey = await EcdsaKeypair.create()
    handle = 'at://ali.example2.com'
    atpPds = 'https://example2.com'

    await client.updateAtprotoKey(did, rotationKey1, signingKey.did())
    await client.updateRotationKeys(did, rotationKey1, [
      newRotationKey.did(),
      rotationKey2.did(),
    ])
    rotationKey1 = newRotationKey

    await client.updateHandle(did, rotationKey1, handle)
    await client.updatePds(did, rotationKey1, atpPds)

    const doc = await client.getDocumentData(did)
    verifyDoc(doc)
  })

  it('does not allow key types that we do not support', async () => {
    // an ed25519 key which we don't yet support
    const newSigningKey =
      'did:key:z6MkjwbBXZnFqL8su24wGL2Fdjti6GSLv9SWdYGswfazUPm9'

    const promise = client.updateAtprotoKey(did, rotationKey1, newSigningKey)
    await expect(promise).rejects.toThrow(PlcClientError)

    const promise2 = client.updateRotationKeys(did, rotationKey1, [
      newSigningKey,
    ])
    await expect(promise2).rejects.toThrow(PlcClientError)
  })

  it('retrieves the operation log', async () => {
    const doc = await client.getDocumentData(did)
    const ops = await client.getOperationLog(did)
    const computedDoc = await plc.validateOperationLog(did, ops)
    expect(computedDoc).toEqual(doc)
  })

  it('rejects on bad updates', async () => {
    const newKey = await EcdsaKeypair.create()
    const operation = client.updateAtprotoKey(did, newKey, newKey.did())
    await expect(operation).rejects.toThrow()
  })

  it('allows for recovery through a forked history', async () => {
    const attackerKey = await EcdsaKeypair.create()
    await client.updateRotationKeys(did, rotationKey2, [attackerKey.did()])

    const newKey = await EcdsaKeypair.create()
    const ops = await client.getOperationLog(did)
    const forkPoint = ops.at(-2)
    if (!check.is(forkPoint, plc.def.operation)) {
      throw new Error('Could not find fork point')
    }
    const op = await plc.updateRotationKeysOp(forkPoint, rotationKey1, [
      rotationKey1.did(),
      newKey.did(),
    ])
    await client.sendOperation(did, op)

    rotationKey2 = newKey

    const doc = await client.getDocumentData(did)
    verifyDoc(doc)
  })

  it('retrieves the auditable operation log', async () => {
    const log = await client.getOperationLog(did)
    const auditable = await client.getAuditableLog(did)
    // has one nullifed op
    expect(auditable.length).toBe(log.length + 1)
    expect(auditable.filter((op) => op.nullified).length).toBe(1)
    expect(auditable.at(-2)?.nullified).toBe(true)
    expect(
      auditable.every((op) => check.is(op, plc.def.exportedOp)),
    ).toBeTruthy()
  })

  it('retrieves the did doc', async () => {
    const data = await client.getDocumentData(did)
    const doc = await client.getDocument(did)
    expect(doc).toEqual(plc.formatDidDoc(data))
  })

  it('handles concurrent requests to many docs', async () => {
    const COUNT = 20
    const keys: EcdsaKeypair[] = []
    for (let i = 0; i < COUNT; i++) {
      keys.push(await EcdsaKeypair.create())
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
    const keys: EcdsaKeypair[] = []
    for (let i = 0; i < COUNT; i++) {
      keys.push(await EcdsaKeypair.create())
    }
    // const prev = await client.getPrev(did)

    let successes = 0
    let failures = 0
    await Promise.all(
      keys.map(async (key) => {
        try {
          await client.updateAtprotoKey(did, rotationKey1, key.did())
          successes++
        } catch (err) {
          failures++
        }
      }),
    )
    expect(successes).toBe(1)
    expect(failures).toBe(19)

    const ops = await client.getOperationLog(did)
    await plc.validateOperationLog(did, ops)
  })

  it('tombstones the did', async () => {
    await client.tombstone(did, rotationKey1)

    const promise = client.getDocument(did)
    await expect(promise).rejects.toThrow(PlcClientError)
    const promise2 = client.getDocumentData(did)
    await expect(promise2).rejects.toThrow(PlcClientError)
  })

  it('exports the data set', async () => {
    const data = await client.export()
    expect(data.every((row) => check.is(row, plc.def.exportedOp))).toBeTruthy()
    expect(data.length).toBe(29)
    for (let i = 1; i < data.length; i++) {
      expect(data[i].createdAt >= data[i - 1].createdAt).toBeTruthy()
    }
  })

  it('still allows create v1s', async () => {
    const createV1 = await plc.deprecatedSignCreate(
      {
        type: 'create',
        signingKey: signingKey.did(),
        recoveryKey: rotationKey1.did(),
        handle,
        service: atpPds,
        prev: null,
      },
      signingKey,
    )
    const did = await didForCreateOp(createV1)
    await client.sendOperation(did, createV1 as any)
  })

  it('rejects clients over the rate limit', async () => {
    let signingKey = await EcdsaKeypair.create()
    const did = await client.createDid({
      signingKey: signingKey.did(),
      rotationKeys: [rotationKey1.did(), rotationKey2.did()],
      handle,
      pds: atpPds,
      signer: rotationKey1,
    })
    let failed = false
    try {
      for (let i = 0; i < 100; i++) {
        await client.updateAtprotoKey(did, rotationKey1, signingKey.did())
      }
    } catch (rawErr) {
      if (rawErr instanceof PlcClientError) {
        const err = rawErr as PlcClientError
        expect(err.status).toBe(429)
        failed = true
      }
    }
    expect(failed).toBe(true)
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
