// Registers dd-trace's ESM loader hook for the rest of the process. Must be the
// first import so the hook is in place before any other module is resolved.
import 'dd-trace/register.js'
import ddTrace from 'dd-trace'

// No options: plc passed none to `dd-trace/init` before the ESM conversion, so
// this keeps tracer config env-driven and unchanged. atproto's bsync and ozone
// additionally set `logInjection: true`; adopting that here would change log
// output, so it is left as a separate decision.
ddTrace.init()
