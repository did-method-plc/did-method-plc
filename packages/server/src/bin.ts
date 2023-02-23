import './env'
import { Database, PlcDatabase } from './db'
import PlcServer from '.'

const run = async () => {
  const dbPostgresUrl = process.env.DB_POSTGRES_URL

  let db: PlcDatabase
  if (dbPostgresUrl) {
    const pgDb = Database.postgres({ url: dbPostgresUrl })
    await pgDb.migrateToLatestOrThrow()
    db = pgDb
  } else {
    db = Database.mock()
  }

  const envPort = parseInt(process.env.PORT || '')
  const port = isNaN(envPort) ? 2582 : envPort

  const plc = PlcServer.create({ db, port })
  await plc.start()
  console.log(`👤 PLC server is running at http://localhost:${port}`)
}

run()
