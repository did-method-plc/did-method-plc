import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'stream'
import WebSocket from 'ws'
import type { Request, Response } from 'express'
import * as error from '../src/error.js'
import type { CloseFn, TestServerInfo } from './_util.js'
import { runTestServer } from './_util.js'

describe('error handling', () => {
  let server: TestServerInfo
  let close: CloseFn

  beforeAll(async () => {
    server = await runTestServer({ dbSchema: 'error_handling' })
    close = server.close
  })

  afterAll(async () => {
    if (close) await close()
  })

  describe('malformed request bodies', () => {
    it('answers a malformed JSON body with 400 and a JSON error', async () => {
      const res = await fetch(
        `${server.url}/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"not":"valid",',
        },
      )

      // The body parser rejects with a 400. Reaching the error handler before
      // the logger is installed used to make the handler itself throw, which
      // finalhandler turned into a 500 with an HTML body.
      expect(res.status).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      await expect(res.json()).resolves.toMatchObject({
        message: expect.any(String),
      })
    })

    it('still answers an oversized body with 413 and a JSON error', async () => {
      const res = await fetch(
        `${server.url}/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ padding: 'x'.repeat(200 * 1024) }),
        },
      )

      expect(res.status).toBe(413)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
    })
  })

  describe('websocket upgrades that fail before being handled', () => {
    // Connects and resolves with how the socket ended. A leaked socket never
    // ends on its own, so it resolves 'open' once the timeout elapses.
    const connect = (url: string, timeoutMs = 2000) =>
      new Promise<'closed' | 'errored' | 'open'>((resolve) => {
        const ws = new WebSocket(url)
        const timer = setTimeout(() => {
          ws.terminate()
          resolve('open')
        }, timeoutMs)
        const settle = (how: 'closed' | 'errored') => {
          clearTimeout(timer)
          ws.terminate()
          resolve(how)
        }
        ws.on('close', () => settle('closed'))
        ws.on('error', () => settle('errored'))
        ws.on('unexpected-response', () => settle('closed'))
      })

    const wsUrl = () =>
      server.url.replace('http://', 'ws://') + '/export/stream'

    // An error thrown on an upgrade request reaches the error handler while
    // `req.ws.handled` is still false. Express skips plain middleware once it
    // is in the error chain, so the cleanup middleware registered after the
    // handler never runs and the connection is stranded.
    it('does not leave the socket open when the cursor is invalid', async () => {
      await expect(connect(`${wsUrl()}?cursor=-1`)).resolves.not.toBe('open')
    })

    it('does not leave the socket open when the cursor is not a number', async () => {
      await expect(connect(`${wsUrl()}?cursor=banana`)).resolves.not.toBe(
        'open',
      )
    })

    it('does not leave the socket open when the route itself rejects', async () => {
      // `/not-a-did` matches the `/:did` route, which rejects it as a malformed
      // DID. Same leak, reached without going near /export/stream.
      const url = server.url.replace('http://', 'ws://') + '/not-a-did'
      await expect(connect(url)).resolves.not.toBe('open')
    })

    it('still closes upgrades to paths that match no route', async () => {
      // Control: no error is raised, so the cleanup middleware is reached and
      // has always handled this. Guards it against regressing.
      const url = server.url.replace('http://', 'ws://') + '/a/b/c/d'
      await expect(connect(url)).resolves.not.toBe('open')
    })
  })
  // The 4xx paths above go through the route wrapper, which answers locally and
  // never reaches error.handler. 5xx and anything unexpected still do, so the
  // handler needs the same release; these cover that branch directly.
  describe('error.handler on an unhandled upgrade', () => {
    const fakeReq = (handled: boolean) => {
      const socket = new PassThrough()
      const destroy = vi.spyOn(socket, 'destroy')
      const req = {
        log: { debug: vi.fn(), error: vi.fn() },
        ws: { socket, head: Buffer.alloc(0), handled },
      } as unknown as Request
      return { req, destroy }
    }

    const fakeRes = () => {
      const res = {
        headersSent: false,
        status: vi.fn(() => res),
        json: vi.fn(() => res),
      }
      return res as unknown as Response & { status: ReturnType<typeof vi.fn> }
    }

    it('destroys the socket instead of writing a response', () => {
      const { req, destroy } = fakeReq(false)
      const res = fakeRes()
      const next = vi.fn()

      error.handler(new Error('boom'), req, res, next)

      expect(destroy).toHaveBeenCalledOnce()
      expect(res.status).not.toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('leaves a socket alone once a route has taken it over', () => {
      // `handled` is true from the moment handleUpgrade runs, after which the
      // websocket owns the socket and must not be destroyed underneath it.
      const { req, destroy } = fakeReq(true)
      const res = fakeRes()

      error.handler(new Error('boom'), req, res, vi.fn())

      expect(destroy).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(500)
    })

    it('answers ordinary requests normally', () => {
      const res = fakeRes()
      const req = {
        log: { debug: vi.fn(), error: vi.fn() },
      } as unknown as Request

      error.handler(new error.ServerError(400, 'nope'), req, res, vi.fn())

      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
})
