import { check, cidForCbor } from '@atproto/common'
import { EcdsaKeypair, Keypair, Secp256k1Keypair } from '@atproto/crypto'
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
  let rotationKey2: EcdsaKeypair
  let did: string
  let handle = 'alice.example.com'
  let atpPds = 'https://example.com'

  let oldRotationKey1: Secp256k1Keypair

  beforeAll(async () => {
    signingKey = await Secp256k1Keypair.create()
    rotationKey1 = await Secp256k1Keypair.create()
    rotationKey2 = await EcdsaKeypair.create()
  })

  const makeNextOp = async (
    changes: Partial<t.Operation>,
    key: Keypair,
  ): Promise<t.Operation> => {
    const lastOp = ops.at(-1)
    if (!lastOp) {
      throw new Error('expected an op on log')
    }
    const prev = await cidForCbor(lastOp)
    return operations.signOperation(
      {
        type: 'plc_operation',
        verificationMethods: lastOp.verificationMethods,
        rotationKeys: lastOp.rotationKeys,
        alsoKnownAs: lastOp.alsoKnownAs,
        services: lastOp.services,
        prev: prev.toString(),
        ...changes,
      },
      key,
    )
  }

  it('creates a valid create op', async () => {
    const createOp = await operations.signOperation(
      {
        type: 'plc_operation',
        verificationMethods: {
          atproto: signingKey.did(),
        },
        rotationKeys: [rotationKey1.did(), rotationKey2.did()],
        alsoKnownAs: [handle],
        services: {
          atpPds,
        },
        prev: null,
      },
      rotationKey1,
    )
    const isValid = check.is(createOp, t.def.operation)
    expect(isValid).toBeTruthy()
    ops.push(createOp)
    did = await operations.didForCreateOp(createOp)
  })

  it('parses an operation log with no updates', async () => {
    const doc = await data.validateOperationLog(did, ops)

    if (!doc) {
      throw new Error('expected doc')
    }
    expect(doc.did).toEqual(did)
    expect(doc.verificationMethods).toEqual({ atproto: signingKey.did() })
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.alsoKnownAs).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('updates handle', async () => {
    handle = 'ali.example2.com'
    const op = await makeNextOp({ alsoKnownAs: [handle] }, rotationKey1)
    ops.push(op)

    const doc = await data.validateOperationLog(did, ops)
    if (!doc) {
      throw new Error('expected doc')
    }
    expect(doc.did).toEqual(did)
    expect(doc.verificationMethods).toEqual({ atproto: signingKey.did() })
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.alsoKnownAs).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('updates atpPds', async () => {
    atpPds = 'https://example2.com'
    const op = await makeNextOp(
      {
        services: {
          atpPds,
        },
      },
      rotationKey1,
    )
    ops.push(op)

    const doc = await data.validateOperationLog(did, ops)
    if (!doc) {
      throw new Error('expected doc')
    }
    expect(doc.did).toEqual(did)
    expect(doc.verificationMethods).toEqual({ atproto: signingKey.did() })
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.alsoKnownAs).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('rotates signingKey', async () => {
    const newSigningKey = await Secp256k1Keypair.create()
    const op = await makeNextOp(
      {
        verificationMethods: {
          atproto: newSigningKey.did(),
        },
      },
      rotationKey1,
    )
    ops.push(op)

    signingKey = newSigningKey

    const doc = await data.validateOperationLog(did, ops)
    if (!doc) {
      throw new Error('expected doc')
    }
    expect(doc.did).toEqual(did)
    expect(doc.verificationMethods).toEqual({ atproto: signingKey.did() })
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.alsoKnownAs).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('rotates rotation keys', async () => {
    const newRotationKey = await Secp256k1Keypair.create()
    const op = await makeNextOp(
      {
        rotationKeys: [newRotationKey.did(), rotationKey2.did()],
      },
      rotationKey1,
    )
    ops.push(op)

    oldRotationKey1 = rotationKey1
    rotationKey1 = newRotationKey

    const doc = await data.validateOperationLog(did, ops)
    if (!doc) {
      throw new Error('expected doc')
    }

    expect(doc.did).toEqual(did)
    expect(doc.verificationMethods).toEqual({ atproto: signingKey.did() })
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.alsoKnownAs).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('no longer allows operations from old rotation key', async () => {
    const op = await makeNextOp(
      {
        alsoKnownAs: ['bob'],
      },
      oldRotationKey1,
    )
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      InvalidSignatureError,
    )
  })

  it('does not allow operations from the signingKey', async () => {
    const op = await makeNextOp(
      {
        alsoKnownAs: ['bob'],
      },
      signingKey,
    )
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      InvalidSignatureError,
    )
  })

  it('allows for operations from either rotation key', async () => {
    const newHandle = 'ali.example.com'
    const op = await makeNextOp(
      {
        alsoKnownAs: [newHandle],
      },
      rotationKey2,
    )
    ops.push(op)
    handle = newHandle
    const doc = await data.validateOperationLog(did, ops)
    if (!doc) {
      throw new Error('expected doc')
    }
    expect(doc.did).toEqual(did)
    expect(doc.verificationMethods).toEqual({ atproto: signingKey.did() })
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.alsoKnownAs).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('allows tombstoning a DID', async () => {
    const last = await data.getLastOpWithCid(ops)
    const op = await operations.signTombstone(last.cid, rotationKey1)
    const doc = await data.validateOperationLog(did, [...ops, op])
    expect(doc).toBe(null)
  })

  it('requires operations to be in order', async () => {
    const prev = await cidForCbor(ops[ops.length - 2])
    const op = await makeNextOp(
      {
        alsoKnownAs: ['bob.test'],
        prev: prev.toString(),
      },
      rotationKey1,
    )
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      MisorderedOperationError,
    )
  })

  it('does not allow a create operation in the middle of the log', async () => {
    const op = await makeNextOp(
      {
        alsoKnownAs: ['bob.test'],
        prev: null,
      },
      rotationKey1,
    )
    expect(data.validateOperationLog(did, [...ops, op])).rejects.toThrow(
      MisorderedOperationError,
    )
  })

  it('does not allow a tombstone in the middle of the log', async () => {
    const prev = await cidForCbor(ops[ops.length - 2])
    const tombstone = await operations.signTombstone(prev, rotationKey1)
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
