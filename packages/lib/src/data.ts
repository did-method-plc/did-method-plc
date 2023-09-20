import { CID } from 'multiformats/cid'
import { check, cidForCbor, HOUR } from '@atproto/common'
import * as t from './types'
import {
  assureValidCreationOp,
  assureValidSig,
  normalizeOp,
} from './operations'
import {
  ImproperOperationError,
  LateRecoveryError,
  MisorderedOperationError,
} from './error'

export const assureValidNextOp = async (
  did: string,
  ops: t.IndexedOperation[],
  proposed: t.CompatibleOpOrTombstone,
): Promise<{ nullified: CID[]; prev: CID | null }> => {
  // special case if account creation
  if (ops.length === 0) {
    await assureValidCreationOp(did, proposed)
    return { nullified: [], prev: null }
  }

  const proposedPrev = proposed.prev ? CID.parse(proposed.prev) : undefined
  if (!proposedPrev) {
    throw new MisorderedOperationError()
  }

  const indexOfPrev = ops.findIndex((op) => proposedPrev.equals(op.cid))
  if (indexOfPrev < 0) {
    throw new MisorderedOperationError()
  }

  // if we are forking history, these are the ops still in the proposed canonical history
  const opsInHistory = ops.slice(0, indexOfPrev + 1)
  const nullified = ops.slice(indexOfPrev + 1)
  const lastOp = opsInHistory.at(-1)
  if (!lastOp) {
    throw new MisorderedOperationError()
  }
  if (check.is(lastOp.operation, t.def.tombstone)) {
    throw new MisorderedOperationError()
  }
  const lastOpNormalized = normalizeOp(lastOp.operation)
  const firstNullified = nullified[0]

  // if this does not involve nullification
  if (!firstNullified) {
    await assureValidSig(lastOpNormalized.rotationKeys, proposed)
    return { nullified: [], prev: proposedPrev }
  }

  const disputedSigner = await assureValidSig(
    lastOpNormalized.rotationKeys,
    firstNullified.operation,
  )

  const indexOfSigner = lastOpNormalized.rotationKeys.indexOf(disputedSigner)
  const morePowerfulKeys = lastOpNormalized.rotationKeys.slice(0, indexOfSigner)

  await assureValidSig(morePowerfulKeys, proposed)

  // recovery key gets a 72hr window to do historical re-wrties
  if (nullified.length > 0) {
    const RECOVERY_WINDOW = 72 * HOUR
    const timeLapsed = Date.now() - firstNullified.createdAt.getTime()
    if (timeLapsed > RECOVERY_WINDOW) {
      throw new LateRecoveryError(timeLapsed)
    }
  }

  return {
    nullified: nullified.map((op) => op.cid),
    prev: proposedPrev,
  }
}

export const validateOperationLog = async (
  did: string,
  ops: t.CompatibleOpOrTombstone[],
): Promise<t.DocumentData | null> => {
  // make sure they're all validly formatted operations
  const [first, ...rest] = ops
  if (!check.is(first, t.def.compatibleOp)) {
    throw new ImproperOperationError('incorrect structure', first)
  }
  for (const op of rest) {
    if (!check.is(op, t.def.opOrTombstone)) {
      throw new ImproperOperationError('incorrect structure', op)
    }
  }

  // ensure the first op is a valid & signed create operation
  let doc = await assureValidCreationOp(did, first)
  let prev = await cidForCbor(first)

  for (let i = 0; i < rest.length; i++) {
    const op = rest[i]
    if (!op.prev || !CID.parse(op.prev).equals(prev)) {
      throw new MisorderedOperationError()
    }
    await assureValidSig(doc.rotationKeys, op)
    const data = opToData(did, op)
    // if tombstone & last op, return null. else throw
    if (data === null) {
      if (i === rest.length - 1) {
        return null
      } else {
        throw new MisorderedOperationError()
      }
    }
    doc = data
    prev = await cidForCbor(op)
  }

  return doc
}

export const opToData = (
  did: string,
  op: t.CompatibleOpOrTombstone,
): t.DocumentData | null => {
  if (check.is(op, t.def.tombstone)) {
    return null
  }
  const { verificationMethods, rotationKeys, alsoKnownAs, services } =
    normalizeOp(op)
  return { did, verificationMethods, rotationKeys, alsoKnownAs, services }
}

export const getLastOpWithCid = async (
  ops: t.CompatibleOpOrTombstone[],
): Promise<{ op: t.CompatibleOpOrTombstone; cid: CID }> => {
  const op = ops.at(-1)
  if (!op) {
    throw new Error('log is empty')
  }
  const cid = await cidForCbor(op)
  return { op, cid }
}
