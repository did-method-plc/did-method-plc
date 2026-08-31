import { PlcError } from '@did-plc/lib'
import type { ErrorRequestHandler, Request } from 'express'

export const handler: ErrorRequestHandler = (err, req, res, next) => {
  // normalize our PLC errors to server errors
  if (PlcError.is(err)) {
    err = ServerError.fromPlcError(err)
  }

  if (ServerError.is(err) && err.status < 500) {
    req.log.debug(
      { error: { message: err.message, status: err.status } },
      'handled server error',
    )
  } else {
    req.log.error(err, 'unexpected internal server error')
  }
  if (releaseUnhandledUpgrade(req)) {
    return
  }

  if (res.headersSent) {
    return next(err)
  }
  if (ServerError.is(err)) {
    return res.status(err.status).json({ message: err.message })
  } else {
    return res.status(500).json({ message: 'Internal Server Error' })
  }
}

/**
 * Releases the raw socket behind an upgrade request that no route took
 * ownership of, and reports whether it did. Returns false for ordinary
 * requests, which still want a normal response.
 *
 * Both error paths need this. Express skips plain middleware once an error is
 * in flight, so the cleanup middleware at the end of the stack is unreachable
 * from either of them, and an upgrade's `res` is a detached dummy that swallows
 * whatever is written to it — leaving the client hanging until it times out.
 */
export const ownsUnhandledUpgrade = (req: Request): boolean =>
  req.ws !== undefined && req.ws.handled === false

const releaseUnhandledUpgrade = (req: Request): boolean => {
  if (!ownsUnhandledUpgrade(req)) return false
  req.ws?.socket.destroy()
  return true
}

export class ServerError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }

  static is(obj: unknown): obj is ServerError {
    return (
      !!obj &&
      typeof obj === 'object' &&
      typeof (obj as Record<string, unknown>).message === 'string' &&
      typeof (obj as Record<string, unknown>).status === 'number'
    )
  }

  static fromPlcError(err: PlcError): ServerError {
    return new ServerError(400, err.message)
  }
}
