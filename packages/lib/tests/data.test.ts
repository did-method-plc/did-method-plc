import { check, cidForCbor } from '@atproto/common'
import {
  EcdsaKeypair,
  Keypair,
  parseDidKey,
  Secp256k1Keypair,
} from '@atproto/crypto'
import * as uint8arrays from 'uint8arrays'
import { InvalidSignatureError } from '../src'
import * as data from '../src/data'
import * as document from '../src/document'
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

  let oldSigningKey: Secp256k1Keypair
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
        signingKey: lastOp.signingKey,
        rotationKeys: lastOp.rotationKeys,
        handles: lastOp.handles,
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
    const isValid = check.is(createOp, t.def.operation)
    expect(isValid).toBeTruthy()
    ops.push(createOp)
    did = await operations.didForCreateOp(createOp)
  })

  it('parses an operation log with no updates', async () => {
    const doc = await data.validateOperationLog(did, ops)

    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.handles).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('updates handle', async () => {
    handle = 'ali.example2.com'
    const op = await makeNextOp({ handles: [handle] }, rotationKey1)
    ops.push(op)

    const doc = await data.validateOperationLog(did, ops)
    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.handles).toEqual([handle])
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
    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.handles).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('rotates signingKey', async () => {
    const newSigningKey = await Secp256k1Keypair.create()
    const op = await makeNextOp(
      {
        signingKey: newSigningKey.did(),
      },
      rotationKey1,
    )
    ops.push(op)

    oldSigningKey = signingKey
    signingKey = newSigningKey

    const doc = await data.validateOperationLog(did, ops)
    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.handles).toEqual([handle])
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
    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.handles).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  it('no longer allows operations from old rotation key', async () => {
    const op = await makeNextOp(
      {
        handles: ['bob'],
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
        handles: ['bob'],
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
        handles: [newHandle],
      },
      rotationKey2,
    )
    const doc = await data.validateOperationLog(did, ops)
    expect(doc.did).toEqual(did)
    expect(doc.signingKey).toEqual(signingKey.did())
    expect(doc.rotationKeys).toEqual([rotationKey1.did(), rotationKey2.did()])
    expect(doc.handles).toEqual([handle])
    expect(doc.services).toEqual({ atpPds })
  })

  // it('requires operations to be in order', async () => {
  //   const prev = await cidForCbor(ops[ops.length - 2])
  //   const op = await operations.updateAtpPds(
  //     'foobar.com',
  //     prev.toString(),
  //     signingKey,
  //   )
  //   expect(document.validateOperationLog(did, [...ops, op])).rejects.toThrow()
  // })

  // it('does not allow a create operation in the middle of the log', async () => {
  //   const op = await operations.create(
  //     signingKey,
  //     recoveryKey.did(),
  //     handle,
  //     atpPds,
  //   )
  //   expect(document.validateOperationLog(did, [...ops, op])).rejects.toThrow()
  // })

  // it('requires that the log start with a create operation', async () => {
  //   const rest = ops.slice(1)
  //   expect(document.validateOperationLog(did, rest)).rejects.toThrow()
  // })
})
