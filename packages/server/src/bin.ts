import './env'
import { Database, PlcDatabase } from './db'
import PlcServer from '.'

const run = async () => {
  const dbUrl = process.env.DATABASE_URL

  let db: PlcDatabase
  if (dbUrl) {
    const pgDb = Database.postgres({ url: dbUrl })
    await pgDb.migrateToLatestOrThrow()
    db = pgDb
  } else {
    db = Database.mock()
  }

  const envPort = parseInt(process.env.PORT || '')
  const port = isNaN(envPort) ? 2582 : envPort
  const adminSecret = process.env.ADMIN_SECRET || undefined

  const plc = PlcServer.create({ db, port, adminSecret })
  await plc.start()
  console.log(`👤 PLC server is running at http://localhost:${port}`)
}

run()
