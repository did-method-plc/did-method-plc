import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { Secp256k1Keypair } from '@atproto/crypto'
import { Client } from '../src/index.js'
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

  describe('createDid', () => {
    it('posts a genesis op carrying the kem key', async () => {
      const kemKey = await Secp256k1Keypair.create()
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
        'updateAtprotoKey',
        (c, signal) => c.updateAtprotoKey(did, key, key.did(), { signal }),
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
