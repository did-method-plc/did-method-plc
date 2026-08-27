import type { Request, Response } from 'express'
import { MisorderedOperationError } from '@did-plc/lib'
import { handler } from '../src/handler.js'
import { ServerError } from '../src/error.js'

const mockReq = () =>
  ({ log: { debug: () => undefined } }) as unknown as Request

const mockRes = () => {
  const sent: { status?: number; body?: unknown } = {}
  const res = {
    headersSent: false,
    status(code: number) {
      sent.status = code
      return res
    },
    json(body: unknown) {
      sent.body = body
      return res
    },
  }
  return { res: res as unknown as Response, raw: res, sent }
}

// The wrapper starts an async IIFE; give its microtasks a turn to settle.
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('handler()', () => {
  it('resolves a 4xx ServerError into a response without calling next', async () => {
    const { res, sent } = mockRes()
    const calls: unknown[] = []
    handler(async () => {
      throw new ServerError(400, 'Resolution of non-PLC DIDs not supported')
    })(mockReq(), res, (err?: unknown) => calls.push(err))
    await flush()

    expect(calls).toEqual([])
    expect(sent).toEqual({
      status: 400,
      body: { message: 'Resolution of non-PLC DIDs not supported' },
    })
  })

  it('converts a PlcError into a 400 without calling next', async () => {
    const { res, sent } = mockRes()
    const calls: unknown[] = []
    handler(async () => {
      throw new MisorderedOperationError()
    })(mockReq(), res, (err?: unknown) => calls.push(err))
    await flush()

    expect(calls).toEqual([])
    expect(sent.status).toEqual(400)
  })

  it('forwards a 5xx ServerError to next with its stack intact', async () => {
    const { res, sent } = mockRes()
    const calls: unknown[] = []
    const thrown = new ServerError(500, 'boom')
    handler(async () => {
      throw thrown
    })(mockReq(), res, (err?: unknown) => calls.push(err))
    await flush()

    expect(calls).toEqual([thrown])
    expect((calls[0] as Error).stack).toBeDefined()
    expect(sent).toEqual({})
  })

  it('forwards a non-ServerError to next', async () => {
    const { res, sent } = mockRes()
    const calls: unknown[] = []
    const thrown = new TypeError('unexpected')
    handler(async () => {
      throw thrown
    })(mockReq(), res, (err?: unknown) => calls.push(err))
    await flush()

    expect(calls).toEqual([thrown])
    expect(sent).toEqual({})
  })

  it('forwards a 4xx to next when headers were already sent', async () => {
    const { res, raw, sent } = mockRes()
    raw.headersSent = true
    const calls: unknown[] = []
    const thrown = new ServerError(400, 'too late')
    handler(async () => {
      throw thrown
    })(mockReq(), res, (err?: unknown) => calls.push(err))
    await flush()

    expect(calls).toEqual([thrown])
    expect(sent).toEqual({})
  })

  it('does not call next when the handler succeeds', async () => {
    const { res } = mockRes()
    const calls: unknown[] = []
    handler(async () => undefined)(mockReq(), res, (err?: unknown) =>
      calls.push(err),
    )
    await flush()

    expect(calls).toEqual([])
  })
})
