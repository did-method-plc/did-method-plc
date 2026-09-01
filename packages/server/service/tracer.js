// Registers dd-trace's ESM loader hook for the rest of the process. Must be the
// first import so the hook is in place before any other module is resolved.
import 'dd-trace/register.js'
import ddTrace from 'dd-trace'

// Tracer configuration is env-driven (DD_*); no options are set here.
// Enabling `logInjection` would add trace ids to every log record, which
// changes log output, so it is a deliberate choice rather than a default.
ddTrace.init()
