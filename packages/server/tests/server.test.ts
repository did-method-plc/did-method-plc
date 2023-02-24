import { EcdsaKeypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'
import { CloseFn, runTestServer } from './_util'
import { check, cidForCbor } from '@atproto/common'
import { AxiosError } from 'axios'
import { Database } from '../src'
import { signOperation } from '@did-plc/lib'

describe('PLC server', () => {
  let handle = 'alice.example.com'
  let atpPds = 'example.com'

  let close: CloseFn
  let db: Database
  let client: plc.Client

  let signingKey: EcdsaKeypair
  let rotationKey1: EcdsaKeypair
  let rotationKey2: EcdsaKeypair

  let did: string

  beforeAll(async () => {
    const server = await runTestServer({
      dbPostgresSchema: 'server',
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

  it('registers a did', async () => {
    did = await client.create(
      {
        signingKey: signingKey.did(),
        rotationKeys: [rotationKey1.did(), rotationKey2.did()],
        handles: [handle],
        services: {
          atpPds,
        },
      },
      rotationKey1,
    )
  })

  it('retrieves did doc data', async () => {
    const doc = await client.getDocumentData(did)
    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.handles).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('can perform some updates', async () => {
    const newRotationKey = await EcdsaKeypair.create()
    signingKey = await EcdsaKeypair.create()
    handle = 'ali.example2.com'
    atpPds = 'example2.com'

    await client.applyPartialOp(
      did,
      { signingKey: signingKey.did() },
      rotationKey1,
    )

    await client.applyPartialOp(
      did,
      { rotationKeys: [newRotationKey.did(), rotationKey2.did()] },
      rotationKey1,
    )
    rotationKey1 = newRotationKey

    await client.applyPartialOp(did, { handles: [handle] }, rotationKey1)
    await client.applyPartialOp(did, { services: { atpPds } }, rotationKey1)

    const doc = await client.getDocumentData(did)
    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.handles).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('does not allow key types that we do not support', async () => {
    // an ed25519 key which we don't yet support
    const newSigningKey =
      'did:key:z6MkjwbBXZnFqL8su24wGL2Fdjti6GSLv9SWdYGswfazUPm9'

    const promise = client.applyPartialOp(
      did,
      { signingKey: newSigningKey },
      rotationKey1,
    )
    await expect(promise).rejects.toThrow(AxiosError)
  })

  it('retrieves the operation log', async () => {
    const doc = await client.getDocumentData(did)
    const ops = await client.getOperationLog(did)
    const computedDoc = await plc.validateOperationLog(did, ops)
    expect(computedDoc).toEqual(doc)
  })

  it('rejects on bad updates', async () => {
    const newKey = await EcdsaKeypair.create()
    const operation = client.applyPartialOp(
      did,
      { signingKey: newKey.did() },
      newKey,
    )
    await expect(operation).rejects.toThrow()
  })

  it('allows for recovery through a forked history', async () => {
    const attackerKey = await EcdsaKeypair.create()
    await client.applyPartialOp(
      did,
      { signingKey: attackerKey.did(), rotationKeys: [attackerKey.did()] },
      rotationKey2,
    )

    const newKey = await EcdsaKeypair.create()
    const ops = await client.getOperationLog(did)
    const forkPoint = ops.at(-2)
    if (!check.is(forkPoint, plc.def.operation)) {
      throw new Error('Could not find fork point')
    }
    const forkCid = await cidForCbor(forkPoint)
    const op = await signOperation(
      {
        signingKey: signingKey.did(),
        rotationKeys: [newKey.did()],
        handles: forkPoint.handles,
        services: forkPoint.services,
        prev: forkCid.toString(),
      },
      rotationKey1,
    )
    await client.sendOperation(did, op)

    rotationKey1 = newKey

    const doc = await client.getDocumentData(did)
    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([newKey.did()])
    expect(doc.handles).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('retrieves the did doc', async () => {
    const data = await client.getDocumentData(did)
    const doc = await client.getDocument(did)
    expect(doc).toEqual(plc.formatDidDoc(data))
  })

  it('handles concurrent requests to many docs', async () => {
    const COUNT = 100
    const keys: EcdsaKeypair[] = []
    for (let i = 0; i < COUNT; i++) {
      keys.push(await EcdsaKeypair.create())
    }
    await Promise.all(
      keys.map(async (key, index) => {
        await client.create(
          {
            signingKey: key.did(),
            rotationKeys: [key.did()],
            handles: [`user${index}`],
            services: {
              atpPds: `example.com`,
            },
          },
          key,
        )
      }),
    )
  })

  it('resolves races into a coherent history with no forks', async () => {
    const COUNT = 100
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
          await client.applyPartialOp(
            did,
            { signingKey: key.did() },
            rotationKey1,
          )
          successes++
        } catch (err) {
          failures++
        }
      }),
    )
    expect(successes).toBe(1)
    expect(failures).toBe(99)

    const ops = await client.getOperationLog(did)
    await plc.validateOperationLog(did, ops)
  })

  it('exports the data set', async () => {
    await client.export()
  })

  it('healthcheck succeeds when database is available.', async () => {
    const { data, status } = await client.health()
    expect(status).toEqual(200)
    expect(data).toEqual({ version: '0.0.0' })
  })

  it('healthcheck fails when database is unavailable.', async () => {
    await db.db.destroy()
    let error: AxiosError
    try {
      await client.health()
      throw new Error('Healthcheck should have failed')
    } catch (err) {
      if (err instanceof AxiosError) {
        error = err
      } else {
        throw err
      }
    }
    expect(error.response?.status).toEqual(503)
    expect(error.response?.data).toEqual({
      version: '0.0.0',
      error: 'Service Unavailable',
    })
  })
})
