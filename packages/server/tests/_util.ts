import { AddressInfo } from 'net'
import PlcServer, { AppContext } from '../src'
import Database from '../src/db'
import { Redis } from 'ioredis'

export type CloseFn = () => Promise<void>
export type TestServerInfo = {
  ctx: AppContext
  url: string
  db: Database
  close: CloseFn
}

export const runTestServer = async (opts: {
  dbSchema: string
}): Promise<TestServerInfo> => {
  const { dbSchema } = opts
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    throw new Error('No postgres url provided')
  }
  const redisHost = process.env.REDIS_HOST
  if (!redisHost) {
    throw new Error('No redis host provided')
  }
  const redisPort = process.env.REDIS_PORT
  if (!redisPort) {
    throw new Error('No redis port provided')
  }

  const db = Database.postgres({
    url: dbUrl,
    schema: dbSchema,
  })
  await db.migrateToLatestOrThrow()
  const redis = new Redis({ host: redisHost, port: Number(redisPort) })

  const plc = PlcServer.create({ db, redis, debug: true })
  const plcServer = await plc.start()
  const { port } = plcServer.address() as AddressInfo

  return {
    ctx: plc.ctx,
    url: `http://localhost:${port}`,
    db,
    close: async () => {
      await plc.destroy()
    },
  }
}
