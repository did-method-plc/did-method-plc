import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { metrics } from '@opentelemetry/api'
import { metrics as sdkMetrics } from '@opentelemetry/sdk-node'
import { P256Keypair } from '@atproto/crypto'
import { cidForCbor } from '@atproto/common'
import * as plc from '@did-plc/lib'
import WebSocket from 'ws'
import type { TestServerInfo } from './_util.js'

const reader = new sdkMetrics.PeriodicExportingMetricReader({
  exporter: new sdkMetrics.InMemoryMetricExporter(
    sdkMetrics.AggregationTemporality.CUMULATIVE,
  ),
  exportIntervalMillis: 60_000,
})
const provider = new sdkMetrics.MeterProvider({ readers: [reader] })

const collect = async () => {
  const result = await reader.collect()
  expect(result.errors).toEqual([])
  return result.resourceMetrics.scopeMetrics
    .filter(({ scope }) => scope.name === '@did-plc/server')
    .flatMap(({ metrics }) => metrics)
}

const value = async (name: string, attributes: Record<string, string> = {}) => {
  const metric = (await collect()).find(
    ({ descriptor }) => descriptor.name === name,
  )
  const point = metric?.dataPoints.find(({ attributes: actual }) =>
    Object.entries(attributes).every(([key, val]) => actual[key] === val),
  )
  return typeof point?.value === 'number' ? point.value : 0
}

const accepted = (type: string) =>
  value('plc.operations.accepted', { 'operation.type': type })
const rejected = (reason: string) =>
  value('plc.operations.rejected', { 'error.reason': reason })

describe('PLC application metrics', () => {
  let server: TestServerInfo
  let SequencerLeader: typeof import('../src/sequencer/sequencer-leader.js').SequencerLeader

  beforeAll(async () => {
    expect(metrics.setGlobalMeterProvider(provider)).toBe(true)
    // As in production's preload, install the provider before application
    // imports create their instruments. The metrics API otherwise returns no-ops.
    const { runTestServer } = await import('./_util.js')
    SequencerLeader = (await import('../src/sequencer/sequencer-leader.js'))
      .SequencerLeader
    server = await runTestServer({ dbSchema: 'metrics' })
  })

  afterAll(async () => {
    if (server) await server.close()
    await provider.shutdown()
    metrics.disable()
  })

  const post = (did: string, body: unknown) =>
    fetch(`${server.url}/${did}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  const create = async () => {
    const key = await P256Keypair.create()
    const { op, did } = await plc.createOp({
      signer: key,
      signingKey: key.did(),
      rotationKeys: [key.did()],
      handle: 'metrics.example.com',
      pds: 'https://example.com',
    })
    expect((await post(did, op)).status).toBe(200)
    return { key, op, did }
  }

  it('counts committed creates, updates, and tombstones without counting rejected retries', async () => {
    const before = await Promise.all(
      ['create', 'update', 'tombstone'].map(accepted),
    )
    const { key, op, did } = await create()
    const update = await plc.updateHandleOp(op, key, 'new.example.com')
    expect((await post(did, update)).status).toBe(200)
    const tombstone = await plc.tombstoneOp(await cidForCbor(update), key)
    expect((await post(did, tombstone)).status).toBe(200)
    const beforeRejected = await rejected('invalid_prev')
    expect((await post(did, op)).status).toBe(400)
    expect(await rejected('invalid_prev')).toBe(beforeRejected + 1)
    const after = await Promise.all(
      ['create', 'update', 'tombstone'].map(accepted),
    )
    expect(after).toEqual(before.map((count) => count + 1))
  })

  it('counts validation and signature failures once by bounded reason', async () => {
    const { key, op, did } = await create()
    const update = await plc.updateHandleOp(op, key, 'metrics.example.net')
    const unknownDid = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
    const cases: [unknown, string][] = [
      [{ not: 'an operation' }, 'invalid_operation'],
      [{ ...update, alsoKnownAs: ['at://one', 'at://one'] }, 'invalid_alias'],
      [
        { ...update, rotationKeys: ['did:key:invalid'] },
        'invalid_rotation_key',
      ],
      [
        {
          ...update,
          services: { test: { type: 'x', endpoint: 'x'.repeat(513) } },
        },
        'invalid_service',
      ],
      [
        { ...update, verificationMethods: { atproto: 'did:key:invalid' } },
        'invalid_verification_method',
      ],
      [{ ...update, alsoKnownAs: ['x'.repeat(5000)] }, 'operation_too_large'],
      [
        await plc.updateHandleOp(
          op,
          await P256Keypair.create(),
          'invalid.example.com',
        ),
        'invalid_signature',
      ],
    ]
    for (const [body, reason] of cases) {
      const before = await rejected(reason)
      expect((await post(did, body)).status).toBe(400)
      expect(await rejected(reason)).toBe(before + 1)
    }
    const before = await rejected('genesis_mismatch')
    expect((await post(unknownDid, op)).status).toBe(400)
    expect(await rejected('genesis_mismatch')).toBe(before + 1)

    const serialized = JSON.stringify(await collect())
    expect(serialized).not.toContain(did)
    expect(serialized).not.toContain(key.did())
    expect(serialized).not.toContain('metrics.example')
  })

  it('counts the actual per-DID rate limit without counting the rejected operation as accepted', async () => {
    const created = await create()
    const { key, did } = created
    let op = created.op
    for (let i = 0; i < 9; i++) {
      const next = await plc.updateHandleOp(op, key, `update${i}.example.com`)
      expect((await post(did, next)).status).toBe(200)
      op = next
    }
    const beforeRejected = await rejected('rate_limit')
    const beforeAccepted = await accepted('update')
    const next = await plc.updateHandleOp(op, key, 'ratelimited.example.com')
    const response = await post(did, next)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining('within last hour'),
    })
    expect(await rejected('rate_limit')).toBe(beforeRejected + 1)
    expect(await accepted('update')).toBe(beforeAccepted)
    expect(await server.db.opsForDid(did)).toHaveLength(10)
  })

  it('counts database conflicts and unexpected failures once without accepting the operation', async () => {
    const { op, key, did } = await create()
    const update = await plc.updateHandleOp(op, key, 'failed.example.com')
    const { ServerError } = await import('../src/error.js')
    const cases: [Error, number, string][] = [
      [new ServerError(409, 'conflicting operation'), 409, 'conflict'],
      [new Error(`database failed for ${did}`), 500, 'internal_error'],
    ]
    for (const [error, status, reason] of cases) {
      const beforeRejected = await rejected(reason)
      const beforeAccepted = await accepted('update')
      const validate = vi
        .spyOn(server.db, 'validateAndAddOp')
        .mockRejectedValueOnce(error)
      try {
        expect((await post(did, update)).status).toBe(status)
        expect(await rejected(reason)).toBe(beforeRejected + 1)
        expect(await accepted('update')).toBe(beforeAccepted)
      } finally {
        validate.mockRestore()
      }
    }
  })

  it('excludes parser, admin, and read failures from operation rejection counts', async () => {
    const unknownDid = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
    const counts = async () =>
      (await collect())
        .find((m) => m.descriptor.name === 'plc.operations.rejected')
        ?.dataPoints.map(({ attributes, value }) => ({ attributes, value }))
    const before = await counts()
    const cases: [string, number][] = [
      ['{"invalid":', 400],
      [JSON.stringify({ padding: 'x'.repeat(200 * 1024) }), 413],
    ]
    for (const [body, status] of cases) {
      const response = await fetch(`${server.url}/${unknownDid}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(response.status).toBe(status)
      expect(await counts()).toEqual(before)
    }
    expect(
      (await post('admin/removeInvalidOps', { adminSecret: 'wrong' })).status,
    ).toBe(401)
    expect((await fetch(`${server.url}/${unknownDid}`)).status).toBe(404)
    const malformedAdmin = await fetch(`${server.url}/admin/removeInvalidOps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    expect(malformedAdmin.status).toBe(400)
    expect(await counts()).toEqual(before)
  })

  it('tracks concurrent subscribers and returns to zero after normal and abrupt disconnects', async () => {
    const url = server.url.replace('http:', 'ws:') + '/export/stream'
    expect(await value('plc.stream.subscribers')).toBe(0)
    const first = new WebSocket(url)
    const second = new WebSocket(url)
    try {
      await Promise.all([once(first, 'open'), once(second, 'open')])
      expect(await value('plc.stream.subscribers')).toBe(2)
      const closed = once(first, 'close')
      first.close()
      await closed
      await vi.waitFor(async () =>
        expect(await value('plc.stream.subscribers')).toBe(1),
      )
      const terminated = once(second, 'close')
      second.terminate()
      await terminated
      await vi.waitFor(async () =>
        expect(await value('plc.stream.subscribers')).toBe(0),
      )
    } finally {
      first.terminate()
      second.terminate()
    }

    const invalid = new WebSocket(`${url}?cursor=999999999`)
    await once(invalid, 'close')
    await vi.waitFor(async () =>
      expect(await value('plc.stream.subscribers')).toBe(0),
    )
  })

  it('records the current sequence when leader stats are polled', async () => {
    const leader = new SequencerLeader(server.db)
    const sequencePoints = async () =>
      (await collect()).find(
        (m) => m.descriptor.name === 'plc.sequencer.sequence',
      )?.dataPoints ?? []
    await leader.lastSeq()
    expect(await sequencePoints()).toEqual([])
    const running = leader.run()
    try {
      // Other suites can temporarily hold the database-wide leader lock.
      await vi.waitFor(
        async () => expect((await server.db.curr())?.seq).toBeGreaterThan(0),
        { timeout: 10_000 },
      )
      const seq = await leader.lastSeq()
      expect(await value('plc.sequencer.sequence')).toBe(seq)
    } finally {
      leader.destroy()
      await running
    }
  })
})
