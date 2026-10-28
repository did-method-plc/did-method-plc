import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
type Attributes = { key: string; value: { stringValue?: string } }[]
type Span = {
  name: string
  kind: number
  traceId: string
  spanId: string
  attributes: Attributes
}
type Log = { body: { stringValue?: string }; traceId: string; spanId: string }
type Metric = {
  name: string
  histogram?: { dataPoints: { attributes: Attributes }[] }
  sum?: { dataPoints: { asDouble?: number; asInt?: string }[] }
}
type ResourceBatch = {
  resource: { attributes: Attributes }
  scopeSpans?: { spans: Span[] }[]
  scopeLogs?: { logRecords: Log[] }[]
  scopeMetrics?: { metrics: Metric[] }[]
}
type Export = {
  resourceSpans?: ResourceBatch[]
  resourceLogs?: ResourceBatch[]
  resourceMetrics?: ResourceBatch[]
}

describe('OpenTelemetry preload', () => {
  const received: { path: string; body: Export }[] = []
  const collector = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    received.push({
      path: req.url ?? '',
      body: JSON.parse(Buffer.concat(chunks).toString()),
    })
    res.setHeader('content-type', 'application/json')
    res.end('{}')
  })
  let endpoint: string

  beforeAll(async () => {
    collector.listen(0, '127.0.0.1')
    await once(collector, 'listening')
    endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`
  })

  beforeEach(() => {
    received.length = 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      collector.close((err) => (err ? reject(err) : resolve()))
    })
  })

  const run = async (overrides: NodeJS.ProcessEnv = {}) => {
    // Do not inherit developer/CI exporter settings or file log destinations.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('OTEL_') && !key.startsWith('LOG_'),
      ),
    )
    return execFileAsync(
      process.execPath,
      ['--import=@did-plc/server/telemetry', 'tests/fixtures/telemetry.mjs'],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: {
          ...env,
          LOG_ENABLED: 'true',
          LOG_DESTINATION: '1',
          OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
          OTEL_SEMCONV_STABILITY_OPT_IN: 'http',
          ...overrides,
        },
        timeout: 15_000,
      },
    )
  }

  const batches = (key: keyof Export) =>
    received.flatMap(({ body }) => body[key] ?? [])
  const attribute = (attributes: Attributes, key: string) =>
    attributes.find((attr) => attr.key === key)?.value.stringValue
  const paths = () => [...new Set(received.map(({ path }) => path))].sort()

  it('exports traces, runtime/HTTP metrics, and correlated Pino logs on shutdown', async () => {
    const { stdout } = await run({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint })
    expect(paths()).toEqual(['/v1/logs', '/v1/metrics', '/v1/traces'])

    const spans = batches('resourceSpans').flatMap((batch) =>
      batch.scopeSpans!.flatMap((scope) => scope.spans),
    )
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'GET /_health', kind: 2 }),
        expect.objectContaining({ name: 'GET /:did', kind: 2 }),
        expect.objectContaining({ kind: 3 }),
      ]),
    )

    const metrics = batches('resourceMetrics').flatMap((batch) =>
      batch.scopeMetrics!.flatMap((scope) => scope.metrics),
    )
    expect(metrics.some((metric) => metric.name.startsWith('nodejs.'))).toBe(
      true,
    )
    expect(
      metrics.find((metric) => metric.name === 'plc.stream.subscribers'),
    ).toMatchObject({
      sum: { dataPoints: [expect.objectContaining({ asDouble: 0 })] },
    })
    const httpMetric = metrics.find(
      (metric) => metric.name === 'http.server.request.duration',
    )
    expect(JSON.stringify(httpMetric)).not.toContain('did:plc:')
    expect(httpMetric?.histogram?.dataPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: expect.arrayContaining([
            { key: 'http.route', value: { stringValue: '/:did' } },
          ]),
        }),
      ]),
    )

    const logs = batches('resourceLogs').flatMap((batch) =>
      batch.scopeLogs!.flatMap((scope) => scope.logRecords),
    )
    const log = logs.find(
      (record) => record.body.stringValue === 'telemetry test request',
    )
    expect(log?.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(spans).toContainEqual(
      expect.objectContaining({ traceId: log?.traceId, spanId: log?.spanId }),
    )
    expect(stdout).toContain(`"trace_id":"${log?.traceId}"`)
    expect(logs).toContainEqual(
      expect.objectContaining({
        body: { stringValue: 'telemetry test shutdown' },
      }),
    )
    for (const key of [
      'resourceSpans',
      'resourceMetrics',
      'resourceLogs',
    ] as const) {
      expect(
        attribute(batches(key)[0].resource.attributes, 'service.name'),
      ).toBe('@did-plc/server')
    }
  })

  it.each(['TRACES', 'METRICS', 'LOGS'])(
    'only exports the configured %s signal',
    async (signal) => {
      await run({
        [`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]: `${endpoint}/v1/${signal.toLowerCase()}`,
      })
      expect(paths()).toEqual([`/v1/${signal.toLowerCase()}`])
    },
  )

  it('honors none in exporter lists, resource overrides, and service version', async () => {
    await run({
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_TRACES_EXPORTER: 'otlp,none',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_SERVICE_NAME: 'plc-sequencer',
      OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=custom',
      PLC_VERSION: 'test-version',
    })
    expect(paths()).toEqual(['/v1/logs'])
    const { attributes } = batches('resourceLogs')[0].resource
    expect(attribute(attributes, 'service.name')).toBe('plc-sequencer')
    expect(attribute(attributes, 'service.namespace')).toBe('custom')
    expect(attribute(attributes, 'service.version')).toBe('test-version')
  })

  it.each([undefined, 'true'])(
    'leaves telemetry disabled with no endpoint or the kill switch (%s)',
    async (disabled) => {
      const { stdout } = await run(
        disabled
          ? {
              OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
              OTEL_SDK_DISABLED: disabled,
            }
          : {},
      )
      expect(received).toEqual([])
      expect(stdout).not.toContain('"trace_id"')
    },
  )
})
