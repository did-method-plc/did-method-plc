import { cidForCbor, DAY, HOUR } from '@atproto/common'
import { P256Keypair, Keypair, Secp256k1Keypair } from '@atproto/crypto'
import { CID } from 'multiformats/cid'
import { InvalidSignatureError, LateRecoveryError } from '../src'
import * as data from '../src/data'
import * as operations from '../src/operations'
import * as t from '../src/types'

describe('plc recovery', () => {
  let signingKey: Secp256k1Keypair
  let rotationKey1: Secp256k1Keypair
  let rotationKey2: P256Keypair
  let rotationKey3: P256Keypair
  let did: string
  const handle = 'alice.example.com'
  const atpPds = 'https://example.com'

  let log: t.IndexedOperation[] = []

  let createCid: CID

  beforeAll(async () => {
    signingKey = await Secp256k1Keypair.create()
    rotationKey1 = await Secp256k1Keypair.create()
    rotationKey2 = await P256Keypair.create()
    rotationKey3 = await P256Keypair.create()
  })

  const formatIndexed = async (
    op: t.Operation,
  ): Promise<t.IndexedOperation> => {
    const cid = await cidForCbor(op)

    return {
      did,
      operation: op,
      cid,
      nullified: false,
      createdAt: new Date(),
    }
  }

  const signOpForKeys = async (
    keys: Keypair[],
    prev: CID | null,
    signer: Keypair,
    otherChanges: Partial<t.Operation> = {},
  ) => {
    const unsigned = {
      ...operations.formatAtprotoOp({
        signingKey: signingKey.did(),
        rotationKeys: keys.map((k) => k.did()),
        handle,
        pds: atpPds,
        prev,
      }),
      ...otherChanges,
    }
    const op = await operations.addSignature(unsigned, signer)
    const indexed = await formatIndexed(op)
    return { op, indexed }
  }

  it('creates an op log with rotation', async () => {
    const create = await signOpForKeys(
      [rotationKey1, rotationKey2, rotationKey3],
      null,
      rotationKey1,
    )
    createCid = create.indexed.cid

    log.push({
      ...create.indexed,
      createdAt: new Date(Date.now() - 7 * DAY),
    })

    // key 3 tries to usurp control
    const rotate = await signOpForKeys([rotationKey3], createCid, rotationKey3)

    log.push({
      ...rotate.indexed,
      createdAt: new Date(Date.now() - DAY),
    })

    // and does some additional ops
    const another = await signOpForKeys(
      [rotationKey3],
      rotate.indexed.cid,
      rotationKey3,
      { alsoKnownAs: ['newhandle.test'] },
    )

    log.push({
      ...another.indexed,
      createdAt: new Date(Date.now() - HOUR),
    })
  })

  it('allows a rotation key with higher authority to rewrite history', async () => {
    // key 2 asserts control over key 3
    const rotate = await signOpForKeys([rotationKey2], createCid, rotationKey2)

    const res = await data.assureValidNextOp(did, log, rotate.op)
    expect(res.nullified.length).toBe(2)
    expect(res.nullified[0].equals(log[1].cid))
    expect(res.nullified[1].equals(log[2].cid))
    expect(res.prev?.equals(createCid)).toBeTruthy()

    log = [log[0], rotate.indexed]
  })

  it('does not allow the lower authority key to take control back', async () => {
    const rotate = await signOpForKeys([rotationKey3], createCid, rotationKey3)
    await expect(data.assureValidNextOp(did, log, rotate.op)).rejects.toThrow(
      InvalidSignatureError,
    )
  })

  it('allows a rotation key with even higher authority to rewrite history', async () => {
    const rotate = await signOpForKeys([rotationKey1], createCid, rotationKey1)

    const res = await data.assureValidNextOp(did, log, rotate.op)
    expect(res.nullified.length).toBe(1)
    expect(res.nullified[0].equals(log[1].cid))
    expect(res.prev?.equals(createCid)).toBeTruthy()

    log = [log[0], rotate.indexed]
  })

  it('does not allow the either invalidated key to take control back', async () => {
    const rotate1 = await signOpForKeys([rotationKey3], createCid, rotationKey3)
    await expect(data.assureValidNextOp(did, log, rotate1.op)).rejects.toThrow(
      InvalidSignatureError,
    )

    const rotate2 = await signOpForKeys([rotationKey2], createCid, rotationKey2)
    await expect(data.assureValidNextOp(did, log, rotate2.op)).rejects.toThrow(
      InvalidSignatureError,
    )
  })

  it('does not allow recovery outside of 72 hrs', async () => {
    const rotate = await signOpForKeys([rotationKey3], createCid, rotationKey3)
    const timeOutOps = [
      log[0],
      {
        ...rotate.indexed,
        createdAt: new Date(Date.now() - 4 * DAY),
      },
    ]
    const rotateBack = await signOpForKeys(
      [rotationKey2],
      createCid,
      rotationKey2,
    )
    await expect(
      data.assureValidNextOp(did, timeOutOps, rotateBack.op),
    ).rejects.toThrow(LateRecoveryError)
  })

  it('allows recovery from a tombstoned DID', async () => {
    const tombstone = await operations.tombstoneOp(createCid, rotationKey2)
    const cid = await cidForCbor(tombstone)
    const tombstoneOps = [
      log[0],
      {
        did,
        operation: tombstone,
        cid,
        nullified: false,
        createdAt: new Date(),
      },
    ]
    const rotateBack = await signOpForKeys(
      [rotationKey1],
      createCid,
      rotationKey1,
    )
    const result = await data.assureValidNextOp(
      did,
      tombstoneOps,
      rotateBack.op,
    )
    expect(result.nullified.length).toBe(1)
    expect(result.nullified[0].equals(cid))
    expect(result.prev?.equals(createCid)).toBeTruthy()
  })
})
