import { EcdsaKeypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'
import { CloseFn, runTestServer } from './_util'
import { cidForCbor } from '@atproto/common'
import { AxiosError } from 'axios'
import { Database } from '../src'
import { didForCreateOp } from '@did-plc/lib'

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

    db = server.ctx.db
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
    const op = await plc.signOperation(
      {
        signingKey: signingKey.did(),
        rotationKeys: [rotationKey1.did(), rotationKey2.did()],
        handles: [handle],
        services: {
          atpPds,
        },
        prev: null,
      },
      rotationKey1,
    )
    did = await didForCreateOp(op)
    await client.sendOperation(did, op)
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

    return

    await client.applyPartialOp(
      did,
      { rotationKeys: [newRotationKey.did(), rotationKey2.did()] },
      newRotationKey,
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

  // it('does not allow key types that we do not support', async () => {
  //   // an ed25519 key which we don't yet support
  //   const newSigningKey =
  //     'did:key:z6MkjwbBXZnFqL8su24wGL2Fdjti6GSLv9SWdYGswfazUPm9'

  //   const promise = client.rotateSigningKey(did, newSigningKey, signingKey)
  //   await expect(promise).rejects.toThrow(AxiosError)
  // })

  // it('retrieves the operation log', async () => {
  //   const doc = await client.getDocumentData(did)
  //   const ops = await client.getOperationLog(did)
  //   const computedDoc = await document.validateOperationLog(did, ops)
  //   expect(computedDoc).toEqual(doc)
  // })

  // it('rejects on bad updates', async () => {
  //   const newKey = await EcdsaKeypair.create()
  //   const operation = client.rotateRecoveryKey(did, newKey.did(), newKey)
  //   await expect(operation).rejects.toThrow()
  // })

  // it('allows for recovery through a forked history', async () => {
  //   const attackerKey = await EcdsaKeypair.create()
  //   await client.rotateSigningKey(did, attackerKey.did(), signingKey)
  //   await client.rotateRecoveryKey(did, attackerKey.did(), attackerKey)

  //   const newKey = await EcdsaKeypair.create()
  //   const ops = await client.getOperationLog(did)
  //   const forkPoint = ops[ops.length - 3]
  //   const forkCid = await cidForCbor(forkPoint)
  //   await client.rotateSigningKey(did, newKey.did(), recoveryKey, forkCid)
  //   signingKey = newKey

  //   const doc = await client.getDocumentData(did)
  //   expect(doc.did).toEqual(did)
  //   expect(doc.signingKey).toEqual(signingKey.did())
  //   expect(doc.recoveryKey).toEqual(recoveryKey.did())
  //   expect(doc.handle).toEqual(handle)
  //   expect(doc.atpPds).toEqual(atpPds)
  // })

  // it('retrieves the did doc', async () => {
  //   const data = await client.getDocumentData(did)
  //   const doc = await client.getDocument(did)
  //   expect(doc).toEqual(document.formatDidDoc(data))
  // })

  // it('handles concurrent requests to many docs', async () => {
  //   const COUNT = 100
  //   const keys: EcdsaKeypair[] = []
  //   for (let i = 0; i < COUNT; i++) {
  //     keys.push(await EcdsaKeypair.create())
  //   }
  //   await Promise.all(
  //     keys.map(async (key, index) => {
  //       await client.createDid(key, key.did(), `user${index}`, `example.com`)
  //     }),
  //   )
  // })

  // it('resolves races into a coherent history with no forks', async () => {
  //   const COUNT = 100
  //   const keys: EcdsaKeypair[] = []
  //   for (let i = 0; i < COUNT; i++) {
  //     keys.push(await EcdsaKeypair.create())
  //   }
  //   const prev = await client.getPrev(did)

  //   let successes = 0
  //   let failures = 0
  //   await Promise.all(
  //     keys.map(async (key) => {
  //       try {
  //         await client.rotateSigningKey(did, key.did(), signingKey, prev)
  //         successes++
  //       } catch (err) {
  //         failures++
  //       }
  //     }),
  //   )
  //   expect(successes).toBe(1)
  //   expect(failures).toBe(99)

  //   const ops = await client.getOperationLog(did)
  //   await document.validateOperationLog(did, ops)
  // })

  // it('healthcheck succeeds when database is available.', async () => {
  //   const { data, status } = await client.health()
  //   expect(status).toEqual(200)
  //   expect(data).toEqual({ version: '0.0.0' })
  // })

  // it('healthcheck fails when database is unavailable.', async () => {
  //   await db.db.destroy()
  //   let error: AxiosError
  //   try {
  //     await client.health()
  //     throw new Error('Healthcheck should have failed')
  //   } catch (err) {
  //     if (err instanceof AxiosError) {
  //       error = err
  //     } else {
  //       throw err
  //     }
  //   }
  //   expect(error.response?.status).toEqual(503)
  //   expect(error.response?.data).toEqual({
  //     version: '0.0.0',
  //     error: 'Service Unavailable',
  //   })
  // })
})
