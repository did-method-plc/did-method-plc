// Preload with node --import, before importing any application modules.
import './env.js'
import { register } from 'node:module'
import { diag } from '@opentelemetry/api'
import {
  getBooleanFromEnv,
  getStringFromEnv,
  getStringListFromEnv,
} from '@opentelemetry/core'
import {
  ExpressInstrumentation,
  ExpressLayerType,
} from '@opentelemetry/instrumentation-express'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { containerDetector } from '@opentelemetry/resource-detector-container'
import { NodeSDK, resources } from '@opentelemetry/sdk-node'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { createAddHookMessageChannel } from 'import-in-the-middle'
import pkg from '../package.json' with { type: 'json' }

// Like atproto's opentelemetry-node bootstrap, telemetry is opt-in per signal.
// An endpoint enables a signal unless its exporter list includes "none".
function isSignalConfigured(signal: 'TRACES' | 'METRICS' | 'LOGS'): boolean {
  if (getStringListFromEnv(`OTEL_${signal}_EXPORTER`)?.includes('none')) {
    return false
  }
  return (
    !!getStringFromEnv(`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`) ||
    !!getStringFromEnv('OTEL_EXPORTER_OTLP_ENDPOINT')
  )
}

async function setup(): Promise<void> {
  if (getBooleanFromEnv('OTEL_SDK_DISABLED')) return

  const tracesConfigured = isSignalConfigured('TRACES')
  const metricsConfigured = isSignalConfigured('METRICS')
  const logsConfigured = isSignalConfigured('LOGS')
  if (!tracesConfigured && !metricsConfigured && !logsConfigured) return

  try {
    // Only wrap ESM modules targeted by an instrumentation. Wrapping unrelated
    // modules can change the behavior of otherwise legal export-star graphs.
    const { registerOptions, waitForAllMessagesAcknowledged } =
      createAddHookMessageChannel()
    register(
      '@opentelemetry/instrumentation/hook.mjs',
      import.meta.url,
      registerOptions,
    )

    const sdk = new NodeSDK({
      resource: resources.defaultResource().merge(
        resources.resourceFromAttributes({
          [ATTR_SERVICE_NAME]: pkg.name,
          [ATTR_SERVICE_NAMESPACE]: 'plc',
          [ATTR_SERVICE_VERSION]: process.env.PLC_VERSION || pkg.version,
          'deployment.environment.name': process.env.NODE_ENV || 'production',
        }),
      ),
      // Detected resources, including OTEL_SERVICE_NAME and
      // OTEL_RESOURCE_ATTRIBUTES, take precedence over the defaults above.
      resourceDetectors: [
        resources.envDetector,
        resources.processDetector,
        resources.hostDetector,
        containerDetector,
      ],
      instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation({
          ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
        }),
        new PgInstrumentation(),
        new UndiciInstrumentation(),
        new RuntimeNodeInstrumentation(),
        // Export existing Pino records through the Logs SDK, and inject
        // trace_id/span_id into the normal Pino output for correlation.
        new PinoInstrumentation({ disableLogSending: !logsConfigured }),
      ],
      // NodeSDK otherwise defaults unconfigured signals to localhost:4318.
      // Empty pipelines disable them; undefined keeps SDK env configuration.
      spanProcessors: tracesConfigured ? undefined : [],
      metricReaders: metricsConfigured ? undefined : [],
      logRecordProcessors: logsConfigured ? undefined : [],
    })

    sdk.start()
    await waitForAllMessagesAcknowledged()

    // Services drain their resources on SIGINT/SIGTERM. Flush once the event
    // loop empties so final request spans and shutdown logs are included.
    process.once('beforeExit', () => {
      sdk.shutdown().catch((err) => {
        diag.error('Error terminating OpenTelemetry SDK', err)
      })
    })
  } catch (err) {
    diag.error('Error initializing OpenTelemetry SDK', err)
  }
}

await setup()
