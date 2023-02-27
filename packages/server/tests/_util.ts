import { AddressInfo } from 'net'
import PlcServer, { AppContext } from '../src'
import Database from '../src/db'

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

  const db = Database.postgres({
    url: dbUrl,
    schema: dbSchema,
  })
  await db.migrateToLatestOrThrow()

  const plc = PlcServer.create({ db })
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
