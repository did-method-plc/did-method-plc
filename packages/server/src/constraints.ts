import { cborEncode, check } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from './error'
import { parseDidKey } from '@atproto/crypto'

export function assertValidIncomingOp(
  op: unknown,
): asserts op is plc.OpOrTombstone {
  const byteLength = cborEncode(op).byteLength
  if (byteLength > 4000) {
    throw new ServerError(400, 'Operation too large')
  }
  if (!check.is(op, plc.def.opOrTombstone)) {
    throw new ServerError(400, `Not a valid operation: ${JSON.stringify(op)}`)
  }
  if (op.type === 'plc_tombstone') {
    return
  }
  if (op.alsoKnownAs.length > 10) {
    throw new ServerError(400, 'To many alsoKnownAs items (max 10)')
  }
  const akaDupe: Record<string, boolean> = {}
  for (const aka of op.alsoKnownAs) {
    if (aka.length > 256) {
      throw new ServerError(400, `alsoKnownAs field too long (max 256): ${aka}`)
    }
    if (akaDupe[aka]) {
      throw new ServerError(400, `duplicate alsoKnownAs field: ${aka}`)
    } else {
      akaDupe[aka] = true
    }
  }
  if (op.rotationKeys.length > 5) {
    throw new ServerError(400, 'To many rotationKey items (max 5)')
  }
  for (const key of op.rotationKeys) {
    try {
      parseDidKey(key)
    } catch (err) {
      throw new ServerError(400, `Invalid rotationKey: ${key}`)
    }
  }
  const serviceEntries = Object.entries(op.services)
  if (serviceEntries.length > 10) {
    throw new ServerError(400, 'To many service entries (max 10)')
  }
  for (const [id, service] of serviceEntries) {
    if (id.length > 32) {
      throw new ServerError(400, `Service id too long (max 32): ${id}`)
    }
    if (service.type.length > 256) {
      throw new ServerError(400, 'Service type too long (max 256)')
    }
    if (service.endpoint.length > 512) {
      throw new ServerError(400, 'Service endpoint too long (max 512)')
    }
  }
  const verifyMethods = Object.entries(op.verificationMethods)
  for (const [id, key] of verifyMethods) {
    if (id.length > 32) {
      throw new ServerError(
        400,
        `Verification Method id too long (max 32): ${id}`,
      )
    }
    try {
      parseDidKey(key)
    } catch (err) {
      throw new ServerError(400, `Invalid verificationMethod key: ${key}`)
    }
  }
}
