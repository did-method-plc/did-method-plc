import './env'
import { Database, PlcDatabase } from './db'
import PlcServer from '.'
import { SequencerLeader } from './sequencer'

const waitForDb = async (
  db: Database,
  maxRetries = 30,
  delayMs = 1000,
): Promise<void> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await db.healthCheck()
      console.log('[*] Database is ready')
      return
    } catch (err) {
      if (i === maxRetries - 1) {
        throw new Error(`Database not ready after ${maxRetries} retries`)
      }
      console.log(`[*] Waiting for database... (${i + 1}/${maxRetries})`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

const run = async () => {
  try {
    const dbUrl = process.env.DATABASE_URL

    let db: PlcDatabase
    let leader: SequencerLeader | undefined
    if (dbUrl) {
      console.log('[*] Connecting to database...')
      const pgDb = Database.postgres({ url: dbUrl })

      // Wait for database to be ready (useful when testing via ./pg/with-test-db.sh )
      console.log('[*] Waiting for database to be ready...')
      await waitForDb(pgDb, 30)

      console.log('[*] Running migrations...')
      await pgDb.migrateToLatestOrThrow()
      db = pgDb

      // Start sequencer leader
      console.log('[*] Starting sequencer leader...')
      leader = new SequencerLeader(pgDb)
      leader.run().catch((err) => {
        console.error('Sequencer leader error:', err)
      })
      console.log('[*] Sequencer leader started')
    } else {
      db = Database.mock()
    }

    const envPort = parseInt(process.env.PORT || '')
    const port = isNaN(envPort) ? 2582 : envPort
    const adminSecret = process.env.ADMIN_SECRET || undefined

    console.log('[*] Creating PLC server...')
    const plc = PlcServer.create({ db, port, adminSecret })

    console.log('[*] Starting server...')
    await plc.start()
    console.log(`👤 PLC server is running at http://localhost:${port}`)

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down...')
      leader?.destroy()
      await plc.destroy()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } catch (err) {
    console.error('Fatal error during startup:', err)
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('Unhandled error in run():', err)
  process.exit(1)
})
