import { AddressInfo } from 'net'
import PlcServer, { AppContext } from '../src'
import { Client as plcClient } from '@did-plc/lib'
import Database from '../src/db'
import { P256Keypair } from '@atproto/crypto'

export type CloseFn = () => Promise<void>
export type TestServerInfo = {
  ctx: AppContext
  url: string
  db: Database
  close: CloseFn
}

export const TEST_ADMIN_SECRET = '9sa9zlrF50LJbbre364HBDgL0o8MkVpjoo'

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

  const plc = PlcServer.create({ db, adminSecret: TEST_ADMIN_SECRET })
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

export const createDid = async (client: plcClient): Promise<string> => {
  const key = await P256Keypair.create()
  const did = await client.createDid({
    signingKey: key.did(),
    rotationKeys: [key.did()],
    handle: `stream${Date.now()}-${Math.random().toString(36).slice(2)}`,
    pds: 'https://example.com',
    signer: key,
  })
  return did
}
