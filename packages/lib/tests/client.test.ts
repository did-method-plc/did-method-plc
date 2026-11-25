import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { P256Keypair, Secp256k1Keypair } from '@atproto/crypto'
import {
  Client,
  type MutationOptions,
  type RequestOptions,
  PlcClientError,
  PlcConflictError,
  PlcPrevMismatchError,
  TombstonedDidError,
} from '../src/index.js'
import * as operations from '../src/operations.js'
import type * as t from '../src/types.js'

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void

type MockPlc = {
  client: Client
  requests: { method: string; url: string; body: string }[]
  close: () => Promise<void>
}

const servers: MockPlc[] = []

const mockPlc = async (handler: Handler): Promise<MockPlc> => {
  const requests: MockPlc['requests'] = []
  const sockets = new Set<import('node:net').Socket>()
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ method: req.method ?? '', url: req.url ?? '', body })
    handler(req, res, body)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  const mock: MockPlc = {
    client: new Client(`http://127.0.0.1:${port}`),
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      server.close()
      await once(server, 'close')
    },
  }
  servers.push(mock)
  return mock
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// leaves the request open until the test aborts it or the server closes
const hang: Handler = () => {}

const isAbortError = (err: unknown) =>
  err instanceof Error && err.name === 'AbortError'

afterEach(async () => {
  vi.unstubAllGlobals()
  while (servers.length) await servers.pop()?.close()
})

describe('plc client', () => {
  let key: Secp256k1Keypair
  let did: string
  let lastOp: t.Operation

  beforeAll(async () => {
    key = await Secp256k1Keypair.create()
    const created = await operations.createOp({
      signingKey: key.did(),
      handle: 'alice.example.com',
      pds: 'https://example.com',
      rotationKeys: [key.did()],
      signer: key,
    })
    did = created.did
    lastOp = created.op
  })

  // answers GET /:did/log/last with the create op, and hangs on everything else
  const lastOpThenHang: Handler = (req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/log/last')) {
      return json(res, 200, lastOp)
    }
  }

  describe('errors', () => {
    const catchErr = async (promise: Promise<unknown>): Promise<unknown> => {
      try {
        await promise
      } catch (err) {
        return err
      }
      throw new Error('expected rejection')
    }

    it("uses PLC's message from the response body", async () => {
      const plc = await mockPlc((_req, res) =>
        json(res, 404, { message: `DID not registered: ${did}` }),
      )
      const err = await catchErr(plc.client.getDocument(did))
      expect(err).toBeInstanceOf(PlcClientError)
      const plcErr = err as PlcClientError
      expect(plcErr.status).toEqual(404)
      expect(plcErr.message).toEqual(`DID not registered: ${did}`)
      expect(plcErr.data).toEqual({ message: `DID not registered: ${did}` })
    })

    it('names each error class', async () => {
      const notFound = await mockPlc((_req, res) =>
        json(res, 404, { message: 'nope' }),
      )
      expect(
        ((await catchErr(notFound.client.getDocument(did))) as Error).name,
      ).toEqual('PlcClientError')
      const conflict = await mockPlc((_req, res) =>
        json(res, 409, { message: 'conflict' }),
      )
      const conflictErr = await catchErr(conflict.client.getDocument(did))
      expect(conflictErr).toBeInstanceOf(PlcConflictError)
      expect((conflictErr as Error).name).toEqual('PlcConflictError')
      expect(new TombstonedDidError(did).name).toEqual('TombstonedDidError')
    })

    it('falls back to a generic message without a JSON message', async () => {
      const plc = await mockPlc((_req, res) => {
        res.writeHead(502, { 'content-type': 'text/plain' })
        res.end('bad gateway')
      })
      const err = (await catchErr(
        plc.client.getDocument(did),
      )) as PlcClientError
      expect(err).toBeInstanceOf(PlcClientError)
      expect(err.status).toEqual(502)
      expect(err.message).toMatch(/502/)
      expect(err.data).toEqual('bad gateway')
    })

    it('exposes response headers', async () => {
      const plc = await mockPlc((_req, res) => {
        res.setHeader('x-custom', 'yes')
        res.setHeader('retry-after', '120')
        json(res, 429, { message: 'slow down' })
      })
      const err = (await catchErr(
        plc.client.getDocument(did),
      )) as PlcClientError
      expect(err.headers).toBeInstanceOf(Headers)
      expect(err.headers.get('X-Custom')).toEqual('yes')
      expect(err.headers.get('content-type')).toMatch(/application\/json/)
      expect(err.headers.get('retry-after')).toEqual('120')
    })

    it('maps a 409 to PlcConflictError', async () => {
      const message = 'Proposed prev does not match the most recent operation'
      const plc = await mockPlc((req, res) => {
        if (req.method === 'POST') return json(res, 409, { message })
        return json(res, 200, lastOp)
      })
      const err = await catchErr(plc.client.updateHandle(did, key, 'x.test'))
      expect(err).toBeInstanceOf(PlcConflictError)
      expect(err).not.toBeInstanceOf(PlcPrevMismatchError)
      expect(err).toBeInstanceOf(PlcClientError)
      expect((err as PlcConflictError).status).toEqual(409)
      expect((err as PlcConflictError).message).toEqual(message)
    })

    it.each([
      'If-Match does not match the most recent operation',
      'DID not registered',
    ])('maps a 412 to PlcPrevMismatchError: %s', async (message) => {
      const plc = await mockPlc((req, res) => {
        if (req.method !== 'POST') return json(res, 200, lastOp)
        res.setHeader('x-custom', 'yes')
        return json(res, 412, { message })
      })
      const err = await catchErr(plc.client.updateHandle(did, key, 'x.test'))
      expect(err).toBeInstanceOf(PlcPrevMismatchError)
      expect(err).toBeInstanceOf(PlcClientError)
      expect(err).not.toBeInstanceOf(PlcConflictError)
      const mismatch = err as PlcPrevMismatchError
      expect(mismatch.name).toEqual('PlcPrevMismatchError')
      expect(mismatch.status).toEqual(412)
      expect(mismatch.message).toEqual(message)
      expect(mismatch.data).toEqual({ message })
      expect(mismatch.headers).toBeInstanceOf(Headers)
      expect(mismatch.headers.get('x-custom')).toEqual('yes')
    })

    it('propagates a refused connection as a TypeError', async () => {
      const plc = await mockPlc(hang)
      await plc.close()
      servers.pop()
      const err = await catchErr(plc.client.getDocument(did))
      expect(err).toBeInstanceOf(TypeError)
      expect(err).not.toBeInstanceOf(PlcClientError)
    })

    it('propagates a dropped connection as a TypeError', async () => {
      const plc = await mockPlc((req) => req.socket.destroy())
      const err = await catchErr(plc.client.getDocument(did))
      expect(err).toBeInstanceOf(TypeError)
      expect(err).not.toBeInstanceOf(PlcClientError)
    })

    it('keeps a malformed JSON error body as text', async () => {
      const plc = await mockPlc((_req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end('{nope')
      })
      const err = (await catchErr(
        plc.client.getDocument(did),
      )) as PlcClientError
      expect(err).toBeInstanceOf(PlcClientError)
      expect(err.status).toEqual(500)
      expect(err.data).toEqual('{nope')
      expect(err.message).toMatch(/500/)
    })

    it('maps export failures too', async () => {
      const plc = await mockPlc((_req, res) =>
        json(res, 400, { message: 'Invalid after parameter' }),
      )
      const err = (await catchErr(plc.client.export(1))) as PlcClientError
      expect(err).toBeInstanceOf(PlcClientError)
      expect(err.message).toEqual('Invalid after parameter')
    })

    describe('tombstoned DIDs', () => {
      let tombstone: t.Tombstone

      beforeAll(async () => {
        const { cidForCbor } = await import('@atproto/common')
        tombstone = await operations.tombstoneOp(await cidForCbor(lastOp), key)
      })

      it('ensureLastOp throws TombstonedDidError', async () => {
        const plc = await mockPlc((_req, res) => json(res, 200, tombstone))
        const err = await catchErr(plc.client.ensureLastOp(did))
        expect(err).toBeInstanceOf(TombstonedDidError)
        expect((err as TombstonedDidError).did).toEqual(did)
        expect((err as TombstonedDidError).message).toMatch(/tombstone/)
      })

      it('updates refuse without posting', async () => {
        const plc = await mockPlc((_req, res) => json(res, 200, tombstone))
        const err = await catchErr(plc.client.updateHandle(did, key, 'x.test'))
        expect(err).toBeInstanceOf(TombstonedDidError)
        expect(plc.requests.map((r) => r.method)).toEqual(['GET'])
      })
    })
  })

  describe('fetch', () => {
    const docBody = { id: 'did:plc:mock' }
    const docMock = () => mockPlc((_req, res) => json(res, 200, docBody))

    it('uses a custom fetch', async () => {
      const plc = await docMock()
      const spy = vi.fn((...args: Parameters<typeof fetch>) =>
        globalThis.fetch(...args),
      )
      const client = new Client(plc.client.url, { fetch: spy })
      const doc = await client.getDocument(did)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toMatch(
        new RegExp(`/${encodeURIComponent(did)}$`),
      )
      expect(doc).toEqual(docBody)
    })

    it('resolves the default fetch at call time', async () => {
      const plc = await docMock()
      const client = new Client(plc.client.url)
      const stub = vi.fn(async () => Response.json(docBody))
      vi.stubGlobal('fetch', stub)
      expect(await client.getDocument(did)).toEqual(docBody)
      expect(stub).toHaveBeenCalledTimes(1)
    })

    it('calls the default fetch unbound', async () => {
      const plc = await docMock()
      const client = new Client(plc.client.url)
      const receivers: unknown[] = []
      vi.stubGlobal('fetch', function (this: unknown) {
        receivers.push(this)
        return Promise.resolve(Response.json(docBody))
      })
      await client.getDocument(did)
      expect(receivers).toEqual([undefined])
    })

    it('propagates a custom fetch rejection unchanged', async () => {
      const reason = { not: 'an error' }
      const client = new Client('http://127.0.0.1:1', {
        fetch: () => Promise.reject(reason),
      })
      await expect(client.getDocument(did)).rejects.toBe(reason)
    })

    it('sends ops as JSON', async () => {
      const plc = await mockPlc((_req, res) => {
        res.writeHead(200)
        res.end()
      })
      await plc.client.sendOperation(did, lastOp)
      expect(plc.requests).toHaveLength(1)
      expect(plc.requests[0].method).toEqual('POST')
      expect(JSON.parse(plc.requests[0].body)).toEqual(lastOp)
    })

    it('sets a JSON content-type on posted ops', async () => {
      let contentType: string | undefined
      const plc = await mockPlc((req, res) => {
        contentType = req.headers['content-type']
        res.writeHead(200)
        res.end()
      })
      await plc.client.sendOperation(did, lastOp)
      expect(contentType).toEqual('application/json')
    })

    it('resolves sendOperation on an empty 2xx body', async () => {
      const plc = await mockPlc((_req, res) => {
        res.writeHead(200)
        res.end()
      })
      await expect(
        plc.client.sendOperation(did, lastOp),
      ).resolves.toBeUndefined()
    })

    it('resolves sendOperation on a non-empty 2xx body', async () => {
      const plc = await mockPlc((_req, res) => json(res, 200, { ok: true }))
      await expect(
        plc.client.sendOperation(did, lastOp),
      ).resolves.toBeUndefined()
    })

    it('cancels the unread 2xx body in sendOperation', async () => {
      let cancelled = false
      const body = new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":true}'))
        },
        cancel() {
          cancelled = true
        },
      })
      const client = new Client('http://plc.invalid', {
        fetch: async () => new Response(body, { status: 200 }),
      })
      await expect(client.sendOperation(did, lastOp)).resolves.toBeUndefined()
      expect(cancelled).toBe(true)
    })
  })

  describe('headers', () => {
    const calls: [
      string,
      (c: Client, opts: RequestOptions) => Promise<unknown>,
    ][] = [
      ['getDocument', (c, opts) => c.getDocument(did, opts)],
      ['getDocumentData', (c, opts) => c.getDocumentData(did, opts)],
      ['getOperationLog', (c, opts) => c.getOperationLog(did, opts)],
      ['getAuditableLog', (c, opts) => c.getAuditableLog(did, opts)],
      ['getLastOp', (c, opts) => c.getLastOp(did, opts)],
      ['ensureLastOp', (c, opts) => c.ensureLastOp(did, opts)],
      ['export', (c, opts) => c.export(0, 10, opts)],
      ['health', (c, opts) => c.health(opts)],
      ['sendOperation', (c, opts) => c.sendOperation(did, lastOp, opts)],
      [
        'createDid',
        (c, opts) =>
          c.createDid(
            {
              signingKey: key.did(),
              rotationKeys: [key.did()],
              handle: 'alice.test',
              pds: 'https://pds.test',
              signer: key,
            },
            opts,
          ),
      ],
    ]

    for (const [name, call] of calls) {
      it(`${name} merges default and request headers without leaking overrides`, async () => {
        const requests: Headers[] = []
        const defaults = new Headers({
          authorization: 'Bearer default',
          'x-default': 'yes',
        })
        const client = new Client('https://plc.invalid', {
          headers: defaults,
          fetch: async (_url, init) => {
            requests.push(new Headers(init?.headers))
            return Response.json(lastOp)
          },
        })
        const headers: HeadersInit[] = [
          { Authorization: 'Bearer record', 'x-request': 'yes' },
          [
            ['Authorization', 'Bearer tuples'],
            ['x-request', 'yes'],
          ],
          new Headers({ authorization: 'Bearer headers', 'x-request': 'yes' }),
        ]
        for (const override of headers) {
          await call(client, { headers: override })
        }
        await call(client, {})
        expect(requests.map((h) => h.get('authorization'))).toEqual([
          'Bearer record',
          'Bearer tuples',
          'Bearer headers',
          'Bearer default',
        ])
        expect(requests.map((h) => h.get('x-default'))).toEqual([
          'yes',
          'yes',
          'yes',
          'yes',
        ])
        expect(requests.map((h) => h.get('x-request'))).toEqual([
          'yes',
          'yes',
          'yes',
          null,
        ])
        expect(defaults.get('authorization')).toEqual('Bearer default')
      })
    }
  })

  describe('mutations', () => {
    const updates: [
      string,
      (c: Client, opts: MutationOptions) => Promise<void>,
    ][] = [
      ['updateData', (c, opts) => c.updateData(did, key, (op) => op, opts)],
      [
        'updateAtprotoSigningKey',
        (c, opts) => c.updateAtprotoSigningKey(did, key, key.did(), opts),
      ],
      [
        'updateAtprotoKemKey',
        (c, opts) => c.updateAtprotoKemKey(did, key, key.did(), opts),
      ],
      [
        'updateHandle',
        (c, opts) => c.updateHandle(did, key, 'alice.test', opts),
      ],
      [
        'updatePds',
        (c, opts) => c.updatePds(did, key, 'https://pds.test', opts),
      ],
      [
        'updateRotationKeys',
        (c, opts) => c.updateRotationKeys(did, key, [key.did()], opts),
      ],
      ['tombstone', (c, opts) => c.tombstone(did, key, opts)],
      [
        'sendOperation',
        async (c, opts) => {
          const op = await operations.updateHandleOp(lastOp, key, 'alice.test')
          await c.sendOperation(did, op, opts)
        },
      ],
    ]

    for (const [name, call] of updates) {
      for (const ignorePrevMismatch of [undefined, false, true]) {
        it(`${name} posts with If-Match (ignorePrevMismatch: ${ignorePrevMismatch})`, async () => {
          const requests: { init?: RequestInit; headers: Headers }[] = []
          const client = new Client('https://plc.invalid', {
            headers: { authorization: 'Bearer default', 'If-Match': 'default' },
            fetch: async (_url, init) => {
              requests.push({ init, headers: new Headers(init?.headers) })
              return init?.method === 'POST'
                ? new Response(null)
                : Response.json(lastOp)
            },
          })
          await call(client, {
            ignorePrevMismatch,
            headers: {
              'x-request': 'yes',
              'IF-MATCH': 'override',
              'content-type': 'text/plain',
            },
          })
          const posted = requests.at(-1)!
          expect(posted.init?.method).toEqual('POST')
          const op = JSON.parse(posted.init?.body as string)
          expect(posted.headers.get('if-match')).toEqual(
            ignorePrevMismatch ? '*' : `"${op.prev}"`,
          )
          expect(posted.headers.get('content-type')).toEqual('application/json')
          for (const request of requests) {
            expect(request.headers.get('authorization')).toEqual(
              'Bearer default',
            )
            expect(request.headers.get('x-request')).toEqual('yes')
          }
        })
      }
    }

    it('sends no If-Match on a genesis operation', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(null),
      )
      const client = new Client('https://plc.invalid', { fetch })
      await client.sendOperation(did, lastOp)
      await client.sendOperation(did, lastOp, { ignorePrevMismatch: true })
      for (const [, init] of fetch.mock.calls) {
        expect(new Headers(init?.headers).has('if-match')).toBe(false)
      }
    })

    it.each(['signing', 'kem'] as const)(
      'updates the %s key while preserving other verification methods',
      async (kind) => {
        const kemKey = await P256Keypair.create()
        const replacement = await (kind === 'kem'
          ? P256Keypair.create()
          : Secp256k1Keypair.create())
        const previous = await operations.createAtprotoUpdateOp(lastOp, key, {
          kemKey: kemKey.did(),
          verificationMethods: { other: key.did() },
        })
        let posted: t.Operation | undefined
        const client = new Client('https://plc.invalid', {
          fetch: async (_url, init) => {
            if (init?.method !== 'POST') return Response.json(previous)
            posted = JSON.parse(init.body as string)
            return new Response(null)
          },
        })
        if (kind === 'signing') {
          await client.updateAtprotoSigningKey(did, key, replacement.did())
        } else {
          await client.updateAtprotoKemKey(did, key, replacement.did())
        }
        expect(posted?.verificationMethods).toEqual({
          atproto: kind === 'signing' ? replacement.did() : key.did(),
          atproto_kem: kind === 'kem' ? replacement.did() : kemKey.did(),
          other: key.did(),
        })
        await operations.assureValidSig([key.did()], posted!)
      },
    )
  })

  describe('createDid', () => {
    it('posts a genesis op carrying the kem key', async () => {
      const kemKey = await P256Keypair.create()
      const plc = await mockPlc((_req, res) => json(res, 200, {}))
      const created = await plc.client.createDid({
        signingKey: key.did(),
        kemKey: kemKey.did(),
        handle: 'erin.example.com',
        pds: 'https://example.com',
        rotationKeys: [key.did()],
        signer: key,
      })
      expect(plc.requests).toHaveLength(1)
      const posted = JSON.parse(plc.requests[0].body)
      expect(plc.requests[0].url).toEqual(`/${encodeURIComponent(created)}`)
      expect(posted.verificationMethods).toEqual({
        atproto: key.did(),
        atproto_kem: kemKey.did(),
      })
    })
  })

  describe('export', () => {
    const exported = (seq: number): t.ExportedOpWithSeq => ({
      did,
      operation: lastOp,
      cid: 'bafyreiexample',
      createdAt: new Date(0).toISOString(),
      seq,
      type: 'sequenced_op',
    })

    const jsonLines = (lines: unknown[]): Handler => {
      return (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/jsonlines' })
        res.end(lines.map((l) => JSON.stringify(l)).join('\n'))
      }
    }

    it('parses a page of several ops', async () => {
      const plc = await mockPlc(jsonLines([exported(1), exported(2)]))
      expect(await plc.client.export(0, 2)).toEqual([exported(1), exported(2)])
    })

    it('parses a page of a single op', async () => {
      const plc = await mockPlc(jsonLines([exported(1)]))
      expect(await plc.client.export(0, 1)).toEqual([exported(1)])
    })

    it('parses an empty page', async () => {
      const plc = await mockPlc(jsonLines([]))
      expect(await plc.client.export(5)).toEqual([])
    })
  })

  describe('cancellation', () => {
    describe('abort during the body read', () => {
      const partial: Handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.write('{"id":')
      }

      // headers arrive, then the body stream errors with a generic
      // AbortError (not the signal's reason) when the signal aborts
      const bodyAbortingFetch = (async (_url, init) => {
        const signal = init?.signal
        const body = new ReadableStream({
          start(controller) {
            signal?.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError')),
            )
          },
        })
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch

      const abortSoon = (controller: AbortController, reason: unknown) =>
        setTimeout(() => controller.abort(reason), 30)

      it('rejects with the signal reason on a real partial body', async () => {
        const plc = await mockPlc(partial)
        const reason = new Error('custom reason')
        const controller = new AbortController()
        abortSoon(controller, reason)
        await expect(
          plc.client.getDocument(did, { signal: controller.signal }),
        ).rejects.toBe(reason)
      })

      it('maps a generic body AbortError to the reason (json)', async () => {
        const client = new Client('http://127.0.0.1:1', {
          fetch: bodyAbortingFetch,
        })
        const reason = new Error('custom reason')
        const controller = new AbortController()
        abortSoon(controller, reason)
        await expect(
          client.getDocument(did, { signal: controller.signal }),
        ).rejects.toBe(reason)
      })

      it('maps a generic body AbortError to the reason (export)', async () => {
        const client = new Client('http://127.0.0.1:1', {
          fetch: bodyAbortingFetch,
        })
        const reason = new Error('custom reason')
        const controller = new AbortController()
        abortSoon(controller, reason)
        await expect(
          client.export(0, 1, { signal: controller.signal }),
        ).rejects.toBe(reason)
      })

      it('maps a generic body AbortError to the reason (error body)', async () => {
        const failing = (async (_url, init) => {
          const signal = init?.signal
          const body = new ReadableStream({
            start(controller) {
              signal?.addEventListener('abort', () =>
                controller.error(new DOMException('aborted', 'AbortError')),
              )
            },
          })
          return new Response(body, { status: 500 })
        }) as typeof fetch
        const client = new Client('http://127.0.0.1:1', { fetch: failing })
        const reason = new Error('custom reason')
        const controller = new AbortController()
        abortSoon(controller, reason)
        await expect(
          client.getDocument(did, { signal: controller.signal }),
        ).rejects.toBe(reason)
      })
    })

    const reads: [
      string,
      (c: Client, signal: AbortSignal) => Promise<unknown>,
    ][] = [
      ['getDocument', (c, signal) => c.getDocument(did, { signal })],
      ['getDocumentData', (c, signal) => c.getDocumentData(did, { signal })],
      ['getOperationLog', (c, signal) => c.getOperationLog(did, { signal })],
      ['getAuditableLog', (c, signal) => c.getAuditableLog(did, { signal })],
      ['getLastOp', (c, signal) => c.getLastOp(did, { signal })],
      ['ensureLastOp', (c, signal) => c.ensureLastOp(did, { signal })],
      ['export', (c, signal) => c.export(0, 10, { signal })],
      ['health', (c, signal) => c.health({ signal })],
      [
        'sendOperation',
        (c, signal) => c.sendOperation(did, lastOp, { signal }),
      ],
      [
        'createDid',
        (c, signal) =>
          c.createDid(
            {
              signingKey: key.did(),
              handle: 'bob.example.com',
              pds: 'https://example.com',
              rotationKeys: [key.did()],
              signer: key,
            },
            { signal },
          ),
      ],
    ]

    for (const [name, call] of reads) {
      it(`${name} rejects with an AbortError when aborted mid-request`, async () => {
        const plc = await mockPlc(hang)
        const ac = new AbortController()
        const promise = call(plc.client, ac.signal)
        await waitFor(() => plc.requests.length === 1)
        ac.abort()
        await expect(promise).rejects.toSatisfy(isAbortError)
      })
    }

    it('rejects without making a request when the signal is already aborted', async () => {
      const plc = await mockPlc(hang)
      const signal = AbortSignal.abort()
      await expect(plc.client.getDocument(did, { signal })).rejects.toSatisfy(
        isAbortError,
      )
      expect(plc.requests).toHaveLength(0)
    })

    it('propagates the abort reason', async () => {
      const plc = await mockPlc(hang)
      const reason = new Error('shutting down')
      const ac = new AbortController()
      const promise = plc.client.getDocument(did, { signal: ac.signal })
      await waitFor(() => plc.requests.length === 1)
      ac.abort(reason)
      await expect(promise).rejects.toBe(reason)
    })

    const updates: [
      string,
      (c: Client, signal: AbortSignal) => Promise<void>,
    ][] = [
      [
        'updateData',
        (c, signal) => c.updateData(did, key, (op) => op, { signal }),
      ],
      [
        'updateAtprotoSigningKey',
        (c, signal) =>
          c.updateAtprotoSigningKey(did, key, key.did(), { signal }),
      ],
      [
        'updateHandle',
        (c, signal) => c.updateHandle(did, key, 'carol.test', { signal }),
      ],
      [
        'updatePds',
        (c, signal) => c.updatePds(did, key, 'https://pds.test', { signal }),
      ],
      [
        'updateRotationKeys',
        (c, signal) => c.updateRotationKeys(did, key, [key.did()], { signal }),
      ],
      ['tombstone', (c, signal) => c.tombstone(did, key, { signal })],
      [
        'updateAtprotoKemKey',
        (c, signal) => c.updateAtprotoKemKey(did, key, key.did(), { signal }),
      ],
    ]

    for (const [name, call] of updates) {
      it(`${name} passes the signal to the last-op read`, async () => {
        const plc = await mockPlc(hang)
        const ac = new AbortController()
        const promise = call(plc.client, ac.signal)
        await waitFor(() => plc.requests.length === 1)
        expect(plc.requests[0].method).toEqual('GET')
        ac.abort()
        await expect(promise).rejects.toSatisfy(isAbortError)
      })

      it(`${name} passes the signal to the operation post`, async () => {
        const plc = await mockPlc(lastOpThenHang)
        const ac = new AbortController()
        const promise = call(plc.client, ac.signal)
        await waitFor(() => plc.requests.length === 2)
        expect(plc.requests[1].method).toEqual('POST')
        ac.abort()
        await expect(promise).rejects.toSatisfy(isAbortError)
      })
    }

    it('remains callable without options', async () => {
      const plc = await mockPlc((req, res) => {
        if (req.method === 'POST') return json(res, 200, {})
        return lastOpThenHang(req, res, '')
      })
      await plc.client.updateHandle(did, key, 'dave.test')
      expect(plc.requests.map((r) => r.method)).toEqual(['GET', 'POST'])
    })
  })
})

const waitFor = async (cond: () => boolean, timeoutMs = 5000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
