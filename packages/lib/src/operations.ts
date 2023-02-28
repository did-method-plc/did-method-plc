import * as cbor from '@ipld/dag-cbor'
import * as uint8arrays from 'uint8arrays'
import { Keypair, parseDidKey, sha256, verifySignature } from '@atproto/crypto'
import * as t from './types'
import { check } from '@atproto/common'
import {
  GenesisHashError,
  ImproperlyFormattedDidError,
  ImproperOperationError,
  InvalidSignatureError,
  UnsupportedKeyError,
} from './error'

export const didForCreateOp = async (op: t.CompatibleOp, truncate = 24) => {
  const hashOfGenesis = await sha256(cbor.encode(op))
  const hashB32 = uint8arrays.toString(hashOfGenesis, 'base32')
  const truncated = hashB32.slice(0, truncate)
  return `did:plc:${truncated}`
}

export const signOperation = async (
  op: t.UnsignedOperation,
  signingKey: Keypair,
): Promise<t.Operation> => {
  const data = new Uint8Array(cbor.encode(op))
  const sig = await signingKey.sign(data)
  return {
    ...op,
    sig: uint8arrays.toString(sig, 'base64url'),
  }
}

export const deprecatedSignCreate = async (
  op: t.UnsignedCreateOpV1,
  signingKey: Keypair,
): Promise<t.CreateOpV1> => {
  const data = new Uint8Array(cbor.encode(op))
  const sig = await signingKey.sign(data)
  return {
    ...op,
    sig: uint8arrays.toString(sig, 'base64url'),
  }
}

export const normalizeOp = (op: t.CompatibleOp): t.Operation => {
  if (check.is(op, t.def.operation)) {
    return op
  }
  return {
    signingKey: op.signingKey,
    rotationKeys: [op.recoveryKey, op.signingKey],
    handles: [op.handle],
    services: {
      atpPds: op.service,
    },
    prev: op.prev,
    sig: op.sig,
  }
}

export const assureValidOp = async (op: t.Operation) => {
  // ensure we support the op's keys
  const keys = [op.signingKey, ...op.rotationKeys]
  await Promise.all(
    keys.map(async (k) => {
      try {
        parseDidKey(k)
      } catch (err) {
        throw new UnsupportedKeyError(k, err)
      }
    }),
  )
  if (op.rotationKeys.length > 5) {
    throw new ImproperOperationError('too many rotation keys', op)
  } else if (op.rotationKeys.length < 1) {
    throw new ImproperOperationError('need at least one rotation key', op)
  }
}

export const assureValidCreationOp = async (
  did: string,
  op: t.CompatibleOp,
): Promise<t.DocumentData> => {
  const normalized = normalizeOp(op)
  await assureValidOp(normalized)
  await assureValidSig(normalized.rotationKeys, op)
  const expectedDid = await didForCreateOp(op, 64)
  // id must be >=24 chars & prefix is 8chars
  if (did.length < 32) {
    throw new ImproperlyFormattedDidError('too short')
  }
  if (!expectedDid.startsWith(did)) {
    throw new GenesisHashError(expectedDid)
  }
  if (op.prev !== null) {
    throw new ImproperOperationError('expected null prev on create', op)
  }
  const { signingKey, rotationKeys, handles, services } = normalized
  return { did, signingKey, rotationKeys, handles, services }
}

export const assureValidSig = async (
  allowedDids: string[],
  op: t.CompatibleOp,
): Promise<string> => {
  const { sig, ...opData } = op
  const sigBytes = uint8arrays.fromString(sig, 'base64url')
  const dataBytes = new Uint8Array(cbor.encode(opData))
  for (const did of allowedDids) {
    const isValid = await verifySignature(did, dataBytes, sigBytes)
    if (isValid) {
      return did
    }
  }
  throw new InvalidSignatureError(op)
}
