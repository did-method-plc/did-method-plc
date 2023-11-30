import { check, cidForCbor } from '@atproto/common'
import { P256Keypair, Secp256k1Keypair } from '@atproto/crypto'
import * as ui8 from 'uint8arrays'
import {
  GenesisHashError,
  ImproperOperationError,
  InvalidSignatureError,
  MisorderedOperationError,
} from '../src'
import * as data from '../src/data'
import * as operations from '../src/operations'
import * as t from '../src/types'

describe('plc did data', () => {
  const ops: t.Operation[] = []

  let signingKey: Secp256k1Keypair
  let rotationKey1: Secp256k1Keypair
  let rotationKey2: P256Keypair
  let did: string
  let handle = 'at://alice.example.com'
  let atpPds = 'https://example.com'

  let oldRotationKey1: Secp256k1Keypair

  beforeAll(async () => {
    signingKey = await Secp256k1Keypair.create()
    rotationKey1 = await Secp256k1Keypair.create()
    rotationKey2 = await P256Keypair.create()
  })

  const lastOp = () => {
    const lastOp = ops.at(-1)
    if (!lastOp) {
      throw new Error('expected an op on log')
    }
    return lastOp
  }

  const verifyDoc = (doc: t.DocumentData | null) => {
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

  it('creates a valid create op', async () => {
    const createOp = await operations.atprotoOp({
      signingKey: signingKey.did(),
      rotationKeys: [rotationKey1.did(), rotationKey2.did()],
      handle,
      pds: atpPds,
      prev: null,
      signer: rotationKey1,
    })
    const isValid = check.is(createOp, t.def.operation)
    expect(isValid).toBeTruthy()
    ops.push(createOp)
    did = await operations.didForCreateOp(createOp)
  })

  it('parses an operation log with no updates', async () => {
    const doc = await data.validateOperationLog(did, ops)
    verifyDoc(doc)
  })

  it('updates handle', async () => {
    const noPrefix = 'ali.exampl2.com'
    handle = `at://${noPrefix}`
    const op = await operations.updateHandleOp(lastOp(), rotationKey1, noPrefix)
    ops.push(op)

    const doc = await data.validateOperationLog(did, ops)
    verifyDoc(doc)
  })

  it('updates atpPds', async () => {
    const noPrefix = 'example2.com'
    atpPds = `https://${noPrefix}`
    const op = await operations.updatePdsOp(lastOp(), rotationKey1, noPrefix)
    ops.push(op)

    const doc = await data.validateOperationLog(did, ops)
    verifyDoc(doc)
  })

  it('rotates signingKey', async () => {
    const newSigningKey = await Secp256k1Keypair.create()
    const op = await operations.updateAtprotoKeyOp(
      lastOp(),
      rotationKey1,
      newSigningKey.did(),
    )
    ops.push(op)

    signingKey = newSigningKey

    const doc = await data.validateOperationLog(did, ops)
    verifyDoc(doc)
  })

  it('rotates rotation keys', async () => {
    const newRotationKey = await Secp256k1Keypair.create()
    const op = await operations.updateRotationKeysOp(lastOp(), rotationKey1, [
      newRotationKey.did(),
      rotationKey2.did(),
    ])
    ops.push(op)

    oldRotationKey1 = rotationKey1
    rotationKey1 = newRotationKey

    const doc = await data.validateOperationLog(did, ops)
    verifyDoc(doc)
  })

  it('no longer allows operations from old rotation key', async () => {
    const op = await operations.updateHandleOp(
      lastOp(),
      oldRotationKey1,
      'at://bob',
    )
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      InvalidSignatureError,
    )
  })

  it('does not allow operations from the signingKey', async () => {
    const op = await operations.updateHandleOp(lastOp(), signingKey, 'at://bob')
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      InvalidSignatureError,
    )
  })

  it('does not allow padded signatures', async () => {
    const op = await operations.updateHandleOp(lastOp(), signingKey, 'at://bob')
    op.sig = ui8.toString(ui8.fromString(op.sig, 'base64url'), 'base64urlpad')
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      InvalidSignatureError,
    )
  })

  it('allows for operations from either rotation key', async () => {
    const newHandle = 'at://ali.example.com'
    const op = await operations.updateHandleOp(
      lastOp(),
      rotationKey2,
      newHandle,
    )
    ops.push(op)
    handle = newHandle
    const doc = await data.validateOperationLog(did, ops)
    verifyDoc(doc)
  })

  it('allows tombstoning a DID', async () => {
    const last = await data.getLastOpWithCid(ops)
    const op = await operations.tombstoneOp(last.cid, rotationKey1)
    const doc = await data.validateOperationLog(did, [...ops, op])
    expect(doc).toBe(null)
  })

  it('requires operations to be in order', async () => {
    const op = await operations.updateHandleOp(
      ops[ops.length - 2],
      rotationKey1,
      'at://bob.test',
    )
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      MisorderedOperationError,
    )
  })

  it('does not allow a create operation in the middle of the log', async () => {
    const op = await operations.atprotoOp({
      signingKey: signingKey.did(),
      rotationKeys: [rotationKey1.did(), rotationKey2.did()],
      handle,
      pds: atpPds,
      prev: null,
      signer: rotationKey1,
    })
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      MisorderedOperationError,
    )
  })

  it('does not allow a tombstone in the middle of the log', async () => {
    const prev = await cidForCbor(ops[ops.length - 2])
    const tombstone = await operations.tombstoneOp(prev, rotationKey1)
    expect(
      data.validateOperationLog(did, [
        ...ops.slice(0, ops.length - 1),
        tombstone,
        ops[ops.length - 1],
      ]),
    ).rejects.toThrow(MisorderedOperationError)
  })

  it('requires that the did is the hash of the genesis op', async () => {
    const rest = ops.slice(1)
    expect(data.validateOperationLog(did, rest)).rejects.toThrow(
      GenesisHashError,
    )
  })

  it('requires that the log starts with a create op (no prev)', async () => {
    const rest = ops.slice(1)
    const expectedDid = await operations.didForCreateOp(rest[0])
    expect(data.validateOperationLog(expectedDid, rest)).rejects.toThrow(
      ImproperOperationError,
    )
  })
})
