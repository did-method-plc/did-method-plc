import { NextFunction, Request, RequestHandler, Response } from 'express'
import { PlcError } from '@did-plc/lib'
import { ServerError } from './error'

export type RouteHandler = (req: Request, res: Response) => Promise<unknown>

/**
 * Wraps a route handler so that expected client errors are answered here rather
 * than forwarded to express's error channel.
 *
 * APM instrumentation captures the Error the moment `next(err)` is called, then
 * pays to format its stack when the span is exported — which, against a bundled
 * sourcemap, is expensive. 4xx are ordinary outcomes rather than faults, so we
 * resolve them locally and no Error ever reaches that channel. 5xx and anything
 * unexpected are forwarded untouched, stack included.
 */
export const handler =
  (fn: RouteHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        await fn(req, res)
      } catch (err) {
        const mapped = PlcError.is(err) ? ServerError.fromPlcError(err) : err
        if (ServerError.is(mapped) && mapped.status < 500 && !res.headersSent) {
          // Mirrors the log line error.handler emits for sub-500 errors.
          req.log.debug(
            { error: { message: mapped.message, status: mapped.status } },
            'handled server error',
          )
          res.status(mapped.status).json({ message: mapped.message })
          return
        }
        next(err)
      }
    })()
  }
