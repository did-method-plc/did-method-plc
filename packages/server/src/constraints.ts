import { DAY, HOUR, cborEncode, check } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from './error'
import {
  extractPrefixedBytes,
  extractMultikey,
  parseDidKey,
} from '@atproto/crypto'

const MAX_OP_BYTES = 4000
const MAX_AKA_ENTRIES = 10
const MAX_AKA_LENGTH = 258 // max handle length (253) plus at:// prefix (5)
const MAX_ROTATION_ENTRIES = 10
const MAX_SERVICE_ENTRIES = 10
const MAX_SERVICE_TYPE_LENGTH = 256
const MAX_SERVICE_ENDPOINT_LENGTH = 512
const MAX_VERIFICATION_METHOD_ENTRIES = 10
const MAX_ID_LENGTH = 32
const MAX_DID_KEY_LENGTH = 256 // k256 = 57, BLS12-381 = 143

export function assertValidIncomingOp(
  op: unknown,
): asserts op is plc.OpOrTombstone {
  const byteLength = cborEncode(op).byteLength
  if (byteLength > MAX_OP_BYTES) {
    throw new ServerError(
      400,
      `Operation too large (${MAX_OP_BYTES} bytes maximum in cbor encoding)`,
    )
  }
  if (!check.is(op, plc.def.opOrTombstone)) {
    throw new ServerError(400, `Not a valid operation: ${JSON.stringify(op)}`)
  }
  if (op.type === 'plc_tombstone') {
    return
  }
  if (op.alsoKnownAs.length > MAX_AKA_ENTRIES) {
    throw new ServerError(
      400,
      `Too many alsoKnownAs entries (max ${MAX_AKA_ENTRIES})`,
    )
  }
  const akaDupe = new Set<string>()
  for (const aka of op.alsoKnownAs) {
    if (aka.length > MAX_AKA_LENGTH) {
      throw new ServerError(
        400,
        `alsoKnownAs entry too long (max ${MAX_AKA_LENGTH}): ${aka}`,
      )
    }
    if (akaDupe.has(aka)) {
      throw new ServerError(400, `duplicate alsoKnownAs entry: ${aka}`)
    } else {
      akaDupe.add(aka)
    }
  }
  if (op.rotationKeys.length > MAX_ROTATION_ENTRIES) {
    throw new ServerError(
      400,
      `Too many rotationKey entries (max ${MAX_ROTATION_ENTRIES})`,
    )
  }
  for (const key of op.rotationKeys) {
    try {
      parseDidKey(key)
    } catch (err) {
      throw new ServerError(400, `Invalid rotationKey: ${key}`)
    }
  }
  const serviceEntries = Object.entries(op.services)
  if (serviceEntries.length > MAX_SERVICE_ENTRIES) {
    throw new ServerError(
      400,
      `Too many service entries (max ${MAX_SERVICE_ENTRIES})`,
    )
  }
  for (const [id, service] of serviceEntries) {
    if (id.length > MAX_ID_LENGTH) {
      throw new ServerError(
        400,
        `Service id too long (max ${MAX_ID_LENGTH}): ${id}`,
      )
    }
    if (service.type.length > MAX_SERVICE_TYPE_LENGTH) {
      throw new ServerError(
        400,
        `Service type too long (max ${MAX_SERVICE_TYPE_LENGTH})`,
      )
    }
    if (service.endpoint.length > MAX_SERVICE_ENDPOINT_LENGTH) {
      throw new ServerError(
        400,
        `Service endpoint too long (max ${MAX_SERVICE_ENDPOINT_LENGTH})`,
      )
    }
  }
  const verifyMethods = Object.entries(op.verificationMethods)
  if (verifyMethods.length > MAX_VERIFICATION_METHOD_ENTRIES) {
    throw new ServerError(
      400,
      `Too many Verification Method entries (max ${MAX_VERIFICATION_METHOD_ENTRIES})`,
    )
  }
  for (const [id, key] of verifyMethods) {
    if (id.length > MAX_ID_LENGTH) {
      throw new ServerError(
        400,
        `Verification Method id too long (max ${MAX_ID_LENGTH}): ${id}`,
      )
    }
    if (key.length > MAX_DID_KEY_LENGTH) {
      throw new ServerError(
        400,
        `Verification Method key too long (max ${MAX_DID_KEY_LENGTH}): ${key}`,
      )
    }
    try {
      // perform only minimal did:key syntax checking, with no restrictions on
      // key types
      const multikey = extractMultikey(key) // enforces did:key: prefix
      extractPrefixedBytes(multikey) // enforces base58-btc encoding
    } catch (err) {
      throw new ServerError(400, `Invalid verificationMethod key: ${key}`)
    }
  }
}

const HOUR_LIMIT = 10
const DAY_LIMIT = 30
const WEEK_LIMIT = 100

export const enforceOpsRateLimit = (ops: plc.IndexedOperation[]) => {
  const hourAgo = new Date(Date.now() - HOUR)
  const dayAgo = new Date(Date.now() - DAY)
  const weekAgo = new Date(Date.now() - DAY * 7)
  let withinHour = 0
  let withinDay = 0
  let withinWeek = 0
  for (const op of ops) {
    if (op.createdAt > weekAgo) {
      withinWeek++
      if (withinWeek >= WEEK_LIMIT) {
        throw new ServerError(
          400,
          `Too many operations within last week (max ${WEEK_LIMIT})`,
        )
      }
    }
    if (op.createdAt > dayAgo) {
      withinDay++
      if (withinDay >= DAY_LIMIT) {
        throw new ServerError(
          400,
          `Too many operations within last day (max ${DAY_LIMIT})`,
        )
      }
    }
    if (op.createdAt > hourAgo) {
      withinHour++
      if (withinHour >= HOUR_LIMIT) {
        throw new ServerError(
          400,
          `Too many operations within last hour (max ${HOUR_LIMIT})`,
        )
      }
    }
  }
}
