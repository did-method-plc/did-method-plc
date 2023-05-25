import * as cbor from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'
import * as uint8arrays from 'uint8arrays'
import { Keypair, parseDidKey, sha256, verifySignature } from '@atproto/crypto'
import { check, cidForCbor } from '@atproto/common'
import * as t from './types'
import {
  GenesisHashError,
  ImproperlyFormattedDidError,
  ImproperOperationError,
  InvalidSignatureError,
  MisorderedOperationError,
  UnsupportedKeyError,
} from './error'

export const didForCreateOp = async (op: t.CompatibleOp, truncate = 24) => {
  const hashOfGenesis = await sha256(cbor.encode(op))
  const hashB32 = uint8arrays.toString(hashOfGenesis, 'base32')
  const truncated = hashB32.slice(0, truncate)
  return `did:plc:${truncated}`
}

// Operations formatting
// ---------------------------

export const formatAtprotoOp = (opts: {
  signingKey: string
  handle: string
  pds: string
  rotationKeys: string[]
  prev: CID | null
}): t.UnsignedOperation => {
  return {
    type: 'plc_operation',
    verificationMethods: {
      atproto: opts.signingKey,
    },
    rotationKeys: opts.rotationKeys,
    alsoKnownAs: [ensureAtprotoPrefix(opts.handle)],
    services: {
      atproto_pds: {
        type: 'AtprotoPersonalDataServer',
        endpoint: ensureHttpPrefix(opts.pds),
      },
    },
    prev: opts.prev?.toString() ?? null,
  }
}

export const atprotoOp = async (opts: {
  signingKey: string
  handle: string
  pds: string
  rotationKeys: string[]
  prev: CID | null
  signer: Keypair
}) => {
  return addSignature(formatAtprotoOp(opts), opts.signer)
}

export const createOp = async (opts: {
  signingKey: string
  handle: string
  pds: string
  rotationKeys: string[]
  signer: Keypair
}): Promise<{ op: t.Operation; did: string }> => {
  const op = await atprotoOp({ ...opts, prev: null })
  const did = await didForCreateOp(op)
  return { op, did }
}

export const createUpdateOp = async (
  lastOp: t.CompatibleOp,
  signer: Keypair,
  fn: (normalized: t.UnsignedOperation) => Omit<t.UnsignedOperation, 'prev'>,
): Promise<t.Operation> => {
  const prev = await cidForCbor(lastOp)
  // omit sig so it doesn't accidentally make its way into the next operation
  const { sig, ...normalized } = normalizeOp(lastOp)
  const unsigned = await fn(normalized)
  return addSignature(
    {
      ...unsigned,
      prev: prev.toString(),
    },
    signer,
  )
}

export const createAtprotoUpdateOp = async (
  lastOp: t.CompatibleOp,
  signer: Keypair,
  opts: Partial<{
    signingKey: string
    handle: string
    pds: string
    rotationKeys: string[]
  }>,
) => {
  return createUpdateOp(lastOp, signer, (normalized) => {
    const updated = { ...normalized }
    if (opts.signingKey) {
      updated.verificationMethods = {
        ...normalized.verificationMethods,
        atproto: opts.signingKey,
      }
    }
    if (opts.handle) {
      const formatted = ensureAtprotoPrefix(opts.handle)
      const handleI = normalized.alsoKnownAs.findIndex((h) =>
        h.startsWith('at://'),
      )
      if (handleI < 0) {
        updated.alsoKnownAs = [formatted, ...normalized.alsoKnownAs]
      } else {
        updated.alsoKnownAs = [
          ...normalized.alsoKnownAs.slice(0, handleI),
          formatted,
          ...normalized.alsoKnownAs.slice(handleI + 1),
        ]
      }
    }
    if (opts.pds) {
      const formatted = ensureHttpPrefix(opts.pds)
      updated.services = {
        ...normalized.services,
        atproto_pds: {
          type: 'AtprotoPersonalDataServer',
          endpoint: formatted,
        },
      }
    }
    if (opts.rotationKeys) {
      updated.rotationKeys = opts.rotationKeys
    }
    return updated
  })
}

export const updateAtprotoKeyOp = async (
  lastOp: t.CompatibleOp,
  signer: Keypair,
  signingKey: string,
): Promise<t.Operation> => {
  return createAtprotoUpdateOp(lastOp, signer, { signingKey })
}

export const updateHandleOp = async (
  lastOp: t.CompatibleOp,
  signer: Keypair,
  handle: string,
): Promise<t.Operation> => {
  return createAtprotoUpdateOp(lastOp, signer, { handle })
}

export const updatePdsOp = async (
  lastOp: t.CompatibleOp,
  signer: Keypair,
  pds: string,
): Promise<t.Operation> => {
  return createAtprotoUpdateOp(lastOp, signer, { pds })
}

export const updateRotationKeysOp = async (
  lastOp: t.CompatibleOp,
  signer: Keypair,
  rotationKeys: string[],
): Promise<t.Operation> => {
  return createAtprotoUpdateOp(lastOp, signer, { rotationKeys })
}

export const tombstoneOp = async (
  prev: CID,
  key: Keypair,
): Promise<t.Tombstone> => {
  return addSignature(
    {
      type: 'plc_tombstone',
      prev: prev.toString(),
    },
    key,
  )
}

// Signing operations
// ---------------------------

export const addSignature = async <T extends Record<string, unknown>>(
  object: T,
  key: Keypair,
): Promise<T & { sig: string }> => {
  const data = new Uint8Array(cbor.encode(object))
  const sig = await key.sign(data)
  return {
    ...object,
    sig: uint8arrays.toString(sig, 'base64url'),
  }
}

export const signOperation = async (
  op: t.UnsignedOperation,
  signingKey: Keypair,
): Promise<t.Operation> => {
  return addSignature(op, signingKey)
}

// Backwards compatibility
// ---------------------------

export const deprecatedSignCreate = async (
  op: t.UnsignedCreateOpV1,
  signingKey: Keypair,
): Promise<t.CreateOpV1> => {
  return addSignature(op, signingKey)
}

export const normalizeOp = (op: t.CompatibleOp): t.Operation => {
  if (check.is(op, t.def.operation)) {
    return op
  }
  return {
    type: 'plc_operation',
    verificationMethods: {
      atproto: op.signingKey,
    },
    rotationKeys: [op.recoveryKey, op.signingKey],
    alsoKnownAs: [ensureAtprotoPrefix(op.handle)],
    services: {
      atproto_pds: {
        type: 'AtprotoPersonalDataServer',
        endpoint: ensureHttpPrefix(op.service),
      },
    },
    prev: op.prev,
    sig: op.sig,
  }
}

// Verifying operations/signatures
// ---------------------------

export const assureValidOp = async (op: t.OpOrTombstone) => {
  if (check.is(op, t.def.tombstone)) {
    return true
  }
  // ensure we support the op's keys
  const keys = [...Object.values(op.verificationMethods), ...op.rotationKeys]
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
  op: t.CompatibleOpOrTombstone,
): Promise<t.DocumentData> => {
  if (check.is(op, t.def.tombstone)) {
    throw new MisorderedOperationError()
  }
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
  const { verificationMethods, rotationKeys, alsoKnownAs, services } =
    normalized
  return { did, verificationMethods, rotationKeys, alsoKnownAs, services }
}

export const assureValidSig = async (
  allowedDidKeys: string[],
  op: t.CompatibleOpOrTombstone,
): Promise<string> => {
  const { sig, ...opData } = op
  const sigBytes = uint8arrays.fromString(sig, 'base64url')
  const dataBytes = new Uint8Array(cbor.encode(opData))
  for (const didKey of allowedDidKeys) {
    const isValid = await verifySignature(didKey, dataBytes, sigBytes)
    if (isValid) {
      return didKey
    }
  }
  throw new InvalidSignatureError(op)
}

// Util
// ---------------------------

export const ensureHttpPrefix = (str: string): string => {
  if (str.startsWith('http://') || str.startsWith('https://')) {
    return str
  }
  return `https://${str}`
}

export const ensureAtprotoPrefix = (str: string): string => {
  if (str.startsWith('at://')) {
    return str
  }
  const stripped = str.replace('http://', '').replace('https://', '')
  return `at://${stripped}`
}
