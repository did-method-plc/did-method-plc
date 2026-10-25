# @did-plc/server - DID PLC Directory Service

Reference implementation of the PLC DID method, in Typescript.

This is the software that runs the <https://plc.directory> service.

## OpenTelemetry

The server has a local OpenTelemetry bootstrap, based on the approach used in
atproto's `opentelemetry-node` package. It depends directly on OpenTelemetry;
it does not depend on that package.

The Docker image, `pnpm start`, and `pnpm dev` initialize telemetry before loading
application modules. When running an entrypoint directly, preload it with Node's
`--import` flag. This also applies to the standalone sequencer:

```sh
cd packages/server/service
node --import=@did-plc/server/telemetry sequencer.js
```

Importing `@did-plc/server` as a library does not initialize telemetry.

## Configuration

Telemetry is disabled until an OTLP endpoint is configured. To export all three
signals to a collector listening on port 4318:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=plc-directory \
LOG_ENABLED=true \
pnpm --filter @did-plc/server start
```

The SDK uses standard `OTEL_*` configuration:

| Variable                                            | Behavior                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                       | Enables traces, metrics, and logs; HTTP exporters append `/v1/traces`, `/v1/metrics`, and `/v1/logs`.             |
| `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` | Enables only that signal and overrides the shared endpoint. For HTTP, include the full signal path.               |
| `OTEL_{TRACES,METRICS,LOGS}_EXPORTER=none`          | Disables that signal, including when a shared endpoint is set.                                                    |
| `OTEL_SDK_DISABLED=true`                            | Disables the entire SDK.                                                                                          |
| `OTEL_EXPORTER_OTLP_PROTOCOL`                       | Transport protocol; defaults to `http/protobuf`. Also supports `http/json` and `grpc`, with per-signal overrides. |
| `OTEL_EXPORTER_OTLP_HEADERS`                        | Collector authentication or other headers, with per-signal overrides.                                             |
| `OTEL_SERVICE_NAME`                                 | Overrides the default service name, `@did-plc/server`. Set distinct names for the directory and sequencer.        |
| `OTEL_RESOURCE_ATTRIBUTES`                          | Comma-separated resource attributes, overriding the defaults below.                                               |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`    | Standard trace sampling settings.                                                                                 |
| `OTEL_METRIC_EXPORT_INTERVAL`                       | Metric export interval in milliseconds.                                                                           |

For example, to export only traces, set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and
leave the shared endpoint unset. Unconfigured signals have no export pipeline.
An exporter list containing `none` disables that signal even if other exporters
are listed alongside it.

Default resource attributes include `service.namespace=plc`, `service.version`
from `PLC_VERSION` (falling back to the server package version), and
`deployment.environment.name` from `NODE_ENV` (falling back to `production`).
Environment, process, host, and container resource detectors also run.

The bootstrap loads the same `.env` or `ENV`-selected environment file as the
local server before reading configuration.

## Signals

- **Tracing:** incoming and outgoing HTTP, Express routes, PostgreSQL queries,
  and Undici/fetch requests, using standard trace context propagation.
- **Metrics:** HTTP request duration and Node.js runtime metrics. Express route
  templates keep DID values out of metric dimensions.
- **Logging:** existing Pino records are exported through the OTel Logs SDK.
  Records written inside a trace also carry trace and span IDs in both OTLP logs
  and the normal Pino output. `LOG_ENABLED`, `LOG_LEVEL`, and `LOG_DESTINATION`
  continue to control the logger; set `LOG_ENABLED=true` to produce logs.

Telemetry is flushed on `beforeExit`, after the service drains its resources on
shutdown. Custom entrypoints should close their resources and allow Node to exit
naturally so buffered records can be exported.

## License

MIT / Apache 2.0 dual-licensed.
