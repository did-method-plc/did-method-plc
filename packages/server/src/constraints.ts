import { DAY, HOUR, cborEncode } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from './error'
import { parseDidKey } from '@atproto/crypto'

const MAX_OP_BYTES = 4000
const MAX_AKA_ENTRIES = 10
const MAX_AKA_LENGTH = 256
const MAX_ROTATION_ENTRIES = 10
const MAX_SERVICE_ENTRIES = 10
const MAX_SERVICE_TYPE_LENGTH = 256
const MAX_SERVICE_ENDPOINT_LENGTH = 512
const MAX_ID_LENGTH = 32

export function validateIncomingOp(input: unknown): plc.OpOrTombstone {
  const byteLength = cborEncode(input).byteLength
  if (byteLength > MAX_OP_BYTES) {
    throw new ServerError(
      400,
      `Operation too large (${MAX_OP_BYTES} bytes maximum in cbor encoding)`,
    )
  }

  // We *need* to parse, and use the result of the parsing, to ensure that any
  // unknown fields are removed from the input. "@atproto/common"'s check
  // function will not remove unknown fields.
  const result = plc.def.opOrTombstone.safeParse(input)

  if (!result.success) {
    const errors = result.error.errors.map(
      (e) => `${e.message} at /${e.path.join('/')}`,
    )
    throw new ServerError(
      400,
      errors.length
        ? errors.join('. ') + '.'
        : `Not a valid operation: ${JSON.stringify(input)}`,
    )
  }

  const op = result.data

  if (op.type === 'plc_tombstone') {
    return op
  }
  if (op.alsoKnownAs.length > MAX_AKA_ENTRIES) {
    throw new ServerError(
      400,
      `To many alsoKnownAs entries (max ${MAX_AKA_ENTRIES})`,
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
      `To many service entries (max ${MAX_SERVICE_ENTRIES})`,
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
  for (const [id, key] of verifyMethods) {
    if (id.length > MAX_ID_LENGTH) {
      throw new ServerError(
        400,
        `Verification Method id too long (max ${MAX_ID_LENGTH}): ${id}`,
      )
    }
    try {
      parseDidKey(key)
    } catch (err) {
      throw new ServerError(400, `Invalid verificationMethod key: ${key}`)
    }
  }

  return op
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
          `To many operations within last week (max ${WEEK_LIMIT})`,
        )
      }
    }
    if (op.createdAt > dayAgo) {
      withinDay++
      if (withinDay >= DAY_LIMIT) {
        throw new ServerError(
          400,
          `To many operations within last day (max ${DAY_LIMIT})`,
        )
      }
    }
    if (op.createdAt > hourAgo) {
      withinHour++
      if (withinHour >= HOUR_LIMIT) {
        throw new ServerError(
          400,
          `To many operations within last hour (max ${HOUR_LIMIT})`,
        )
      }
    }
  }
}
