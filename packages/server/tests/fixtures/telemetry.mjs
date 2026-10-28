// This runs in a separate Node process so the preload can instrument ESM
// imports before any application code, just as it does in production.
import { MockDatabase, PlcServer, leaderLogger } from '@did-plc/server'

const plc = PlcServer.create({ db: MockDatabase.create() })
plc.app.get('/telemetry/test', (_req, res) => {
  leaderLogger.info({ fixture: true }, 'telemetry test request')
  res.sendStatus(200)
})

const server = await plc.start()
const address = server.address()
if (!address || typeof address === 'string') {
  throw new Error('Expected server to listen on a TCP port')
}
const origin = `http://localhost:${address.port}`
try {
  for (const path of [
    '/_health',
    '/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
    '/did:plc:bbbbbbbbbbbbbbbbbbbbbbbb',
    '/telemetry/test',
  ]) {
    const response = await fetch(`${origin}${path}`)
    await response.text()
  }
} finally {
  await plc.destroy()
}
leaderLogger.info('telemetry test shutdown')
