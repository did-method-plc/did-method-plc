import { cidForCbor, DAY } from '@atproto/common'
import { Secp256k1Keypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'
import { Kysely } from 'kysely'
import { Database } from '../../src'

describe('refactor migration', () => {
  let db: Database
  let rawDb: Kysely<any>

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      throw new Error('No postgres url provided')
    }
    db = Database.postgres({
      url: dbUrl,
      schema: 'migration_refactor',
    })

    await db.migrateToOrThrow('_20221020T204908820Z')
    rawDb = db.db
  })

  afterAll(async () => {
    await db.close()
  })

  const ops: any[] = []
  let before: any[]

  it('fills the database with some operations', async () => {
    for (let i = 0; i < 100; i++) {
      const signingKey = await Secp256k1Keypair.create()
      const recoveryKey = await Secp256k1Keypair.create()
      const op = await plc.deprecatedSignCreate(
        {
          type: 'create',
          signingKey: signingKey.did(),
          recoveryKey: recoveryKey.did(),
          handle: `user${i}.test`,
          service: 'https://example.com',
          prev: null,
        },
        signingKey,
      )
      const did = await plc.didForCreateOp(op)
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
    }
    await rawDb.insertInto('operations').values(ops).execute()

    before = await rawDb
      .selectFrom('operations')
      .selectAll()
      .orderBy('did', 'asc')
      .execute()
  })

  it('migrates', async () => {
    await db.migrateToOrThrow('_20230223T215019669Z')
  })

  it('correctly migrated all data', async () => {
    const migrated = await rawDb
      .selectFrom('operations')
      .selectAll()
      .orderBy('did', 'asc')
      .execute()
    const ordered = ops.sort((a, b) => a.did.localeCompare(b.did))
    expect(migrated.length).toBe(ordered.length)
    for (let i = 0; i < migrated.length; i++) {
      expect(migrated[i].did).toBe(ordered[i].did)
      expect(migrated[i].operation).toEqual(JSON.parse(ordered[i].operation))
      expect(migrated[i].cid).toBe(ordered[i].cid)
      expect(migrated[i].nullified).toBe(
        ordered[i].nullified === 1 ? true : false,
      )
      expect(migrated[i].createdAt).toEqual(new Date(ordered[i].createdAt))
    }
  })

  it('migrates down', async () => {
    await db.migrateToOrThrow('_20221020T204908820Z')
    const migratedBack = await rawDb
      .selectFrom('operations')
      .selectAll()
      .orderBy('did', 'asc')
      .execute()
    expect(migratedBack.length).toBe(before.length)
    // normalize json
    const beforeNormalized = before.map((row) => ({
      ...row,
      operation: JSON.parse(row.operation),
    }))
    const migratedNormalized = migratedBack.map((row) => ({
      ...row,
      operation: JSON.parse(row.operation),
    }))

    expect(migratedNormalized).toEqual(beforeNormalized)
  })
})
