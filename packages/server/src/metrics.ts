import { metrics } from '@opentelemetry/api'
import * as plc from '@did-plc/lib'
import type { ErrorRequestHandler } from 'express'
import { ServerError } from './error.js'
import type { OperationRejectionReason } from './error.js'

const meter = metrics.getMeter('@did-plc/server')

export const sequencerSequence = meter.createGauge('plc.sequencer.sequence', {
  description: 'Latest sequence reported by the sequencer leader',
  unit: '{operation}',
})

export const streamSubscribers = meter.createUpDownCounter(
  'plc.stream.subscribers',
  {
    description: 'Active export stream WebSocket subscribers',
    unit: '{subscriber}',
  },
)

const acceptedOperations = meter.createCounter('plc.operations.accepted', {
  description: 'Operations accepted and committed through the API',
  unit: '{operation}',
})

const rejectedOperations = meter.createCounter('plc.operations.rejected', {
  description: 'Operation submissions rejected by the API',
  unit: '{operation}',
})

export function recordAcceptedOperation(op: plc.OpOrTombstone): void {
  const type =
    op.type === 'plc_tombstone'
      ? 'tombstone'
      : op.prev === null
        ? 'create'
        : 'update'
  acceptedOperations.add(1, { 'operation.type': type })
}

function rejectionReason(err: unknown): OperationRejectionReason {
  if (err instanceof plc.InvalidSignatureError) return 'invalid_signature'
  if (err instanceof plc.MisorderedOperationError) return 'invalid_prev'
  if (err instanceof plc.LateRecoveryError) return 'late_recovery'
  if (err instanceof plc.GenesisHashError) return 'genesis_mismatch'
  if (err instanceof plc.ImproperlyFormattedDidError) return 'invalid_did'
  if (err instanceof plc.UnsupportedKeyError) return 'unsupported_key'
  if (plc.PlcError.is(err)) return 'invalid_operation'
  if (ServerError.is(err)) {
    if (err.reason) return err.reason
    if (err.status === 409) return 'conflict'
    if (err.status === 429) return 'rate_limit'
    if (err.status < 500) return 'invalid_operation'
  }
  return 'internal_error'
}

export function recordRejectedOperation(err: unknown): void {
  rejectedOperations.add(1, { 'error.reason': rejectionReason(err) })
}

// Body parsing runs before the operation route. Count those rejections here;
// the route counts validation, rate-limit, and database failures itself.
export const bodyParserErrorMetrics: ErrorRequestHandler = (
  err,
  req,
  _res,
  next,
) => {
  if (req.method === 'POST' && /^\/[^/]+\/?$/.test(req.path)) {
    const type: unknown = err?.type
    let reason: OperationRejectionReason | undefined
    if (type === 'entity.parse.failed') reason = 'invalid_json'
    else if (type === 'entity.too.large') reason = 'body_too_large'
    else if (
      typeof type === 'string' &&
      [
        'request.aborted',
        'request.size.invalid',
        'encoding.unsupported',
        'charset.unsupported',
        'stream.encoding.set',
        'stream.not.readable',
        'entity.verify.failed',
      ].includes(type)
    )
      reason = 'invalid_request_body'
    if (reason) rejectedOperations.add(1, { 'error.reason': reason })
  }
  next(err)
}
