# @did-plc/server - DID PLC Directory Service

Reference implementation of the PLC DID method, in Typescript.

This is the software that runs the <https://plc.directory> service.

## OpenTelemetry

The server exports traces, metrics, and Pino logs over OTLP. The Docker image,
`pnpm start`, and `pnpm dev` initialize telemetry before loading application
modules. For direct entrypoints, preload it with Node's `--import` flag:

```sh
cd packages/server/service
node --import=@did-plc/server/telemetry sequencer.js
```

Importing `@did-plc/server` as a library does not initialize telemetry.

### Configuration

Telemetry is disabled until an OTLP endpoint is configured. To export all signals:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=plc-directory \
LOG_ENABLED=true \
pnpm --filter @did-plc/server start
```

The SDK uses standard `OTEL_*` configuration:

| Variable                                            | Behavior                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                       | Enables all signals; HTTP exporters append `/v1/traces`, `/v1/metrics`, or `/v1/logs`.        |
| `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` | Enables one signal and overrides the shared endpoint. HTTP URLs must include the signal path. |
| `OTEL_{TRACES,METRICS,LOGS}_EXPORTER=none`          | Disables a signal, even with a shared endpoint.                                               |
| `OTEL_SDK_DISABLED=true`                            | Disables telemetry.                                                                           |
| `OTEL_EXPORTER_OTLP_PROTOCOL`                       | Defaults to `http/protobuf`; also supports `http/json` and `grpc`.                            |
| `OTEL_EXPORTER_OTLP_HEADERS`                        | Collector authentication or other headers.                                                    |
| `OTEL_SERVICE_NAME`                                 | Defaults to `@did-plc/server`. Use distinct names for the directory and sequencer.            |
| `OTEL_RESOURCE_ATTRIBUTES`                          | Comma-separated resource attributes that override defaults.                                   |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`    | Trace sampling settings.                                                                      |
| `OTEL_METRIC_EXPORT_INTERVAL`                       | Metric export interval in milliseconds.                                                       |

To export only traces, set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and leave the shared
endpoint unset. An exporter list containing `none` disables that signal.

Default resource attributes include `service.namespace=plc`, `service.version`
from `PLC_VERSION` (falling back to the server package version), and
`deployment.environment.name` from `NODE_ENV` (falling back to `production`).
Environment, process, host, and container resource detectors also run.

Configuration is read after loading the server's `.env` or `ENV`-selected file.

### Signals

- **Tracing:** incoming and outgoing HTTP, Express routes, PostgreSQL queries,
  and Undici/fetch requests.
- **Metrics:** HTTP request duration and Node.js runtime metrics. Express route
  templates keep DID values out of metric dimensions.
- **Logging:** Pino records, with trace and span IDs in both OTLP logs and normal
  output. `LOG_ENABLED`, `LOG_LEVEL`, and `LOG_DESTINATION` still control the
  logger; set `LOG_ENABLED=true` to produce logs.

Application metrics use the `@did-plc/server` meter:

| Metric                    | Meaning                                                                               | Attributes                                           |
| ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `plc.sequencer.sequence`  | Gauge of the latest sequence sampled by the existing leader stats polling.            | None                                                 |
| `plc.stream.subscribers`  | Up/down counter of active `/export/stream` WebSocket connections, including backfill. | None                                                 |
| `plc.operations.accepted` | Counter of operation submissions successfully committed through the API.              | `operation.type`: `create`, `update`, or `tombstone` |
| `plc.operations.rejected` | Counter of failed operation submissions, including malformed bodies and rate limits.  | `error.reason`: a fixed reason code                  |

Recovery operations count as updates. Rejection reasons distinguish invalid
operations, size limits, aliases, rotation keys, services, verification methods,
signatures, previous operations, recovery windows, genesis hashes, DIDs, key
support, conflicts, rate limits, body parsing, and internal errors. Rate limits
use `rate_limit`, including the existing limits that respond with HTTP 400.
Metric attributes never include DIDs, keys, or error messages.

Telemetry flushes on `beforeExit`. Custom entrypoints should close their resources
and let Node exit naturally to export buffered records.

## License

MIT / Apache 2.0 dual-licensed.
