import { cidForCbor, DAY } from '@atproto/common'
import { Secp256k1Keypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'
import { Kysely } from 'kysely'
import { Database } from '../../src'

describe('did-locks migration', () => {
  let db: Database
  let rawDb: Kysely<any>

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      throw new Error('No postgres url provided')
    }
    db = Database.postgres({
      url: dbUrl,
      schema: 'migration_did_locks',
    })

    await db.migrateToOrThrow('_20230223T215019669Z')
    rawDb = db.db
  })

  afterAll(async () => {
    await db.close()
  })

  const dids: string[] = []

  it('fills the database with some operations', async () => {
    const ops: any[] = []
    for (let i = 0; i < 100; i++) {
      const signingKey = await Secp256k1Keypair.create()
      const recoveryKey = await Secp256k1Keypair.create()
      const { op, did } = await plc.createOp({
        signingKey: signingKey.did(),
        rotationKeys: [recoveryKey.did()],
        handle: `user${i}.test`,
        pds: 'https://example.com',
        signer: recoveryKey,
      })
      const cid = await cidForCbor(op)
      const randomOffset = Math.floor(Math.random() * DAY * 60)
      const time = new Date(Date.now() - randomOffset).toISOString()
      ops.push({
        did,
        operation: JSON.stringify(op),
        cid: cid.toString(),
        nullified: 0,
        createdAt: time,
      })
      dids.push(did)
      const op2 = await plc.updateHandleOp(op, recoveryKey, `user${i}-2.test`)
      const cid2 = await cidForCbor(op2)
      ops.push({
        did,
        operation: JSON.stringify(op2),
        cid: cid2.toString(),
        nullified: 0,
        createdAt: new Date().toISOString(),
      })
    }
    await rawDb.insertInto('operations').values(ops).execute()
  })

  it('migrates', async () => {
    await db.migrateToOrThrow('_20230406T174552885Z')
  })

  it('correctly filled in dids', async () => {
    const migrated = await rawDb.selectFrom('dids').selectAll().execute()
    const sorted = migrated.map((row) => row.did).sort()
    expect(sorted).toEqual(dids.sort())
  })
})
