import { Kysely, Migrator, PostgresDialect, sql } from 'kysely'
import { Pool as PgPool, types as pgTypes } from 'pg'
import { CID } from 'multiformats/cid'
import { cidForCbor, check } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from '../error'
import * as migrations from '../migrations'
import { OpLogExport, PlcDatabase } from './types'
import MockDatabase from './mock'

export * from './mock'
export * from './types'

export class Database implements PlcDatabase {
  migrator: Migrator
  constructor(public db: Kysely<DatabaseSchema>, public schema?: string) {
    this.migrator = new Migrator({
      db,
      migrationTableSchema: schema,
      provider: {
        async getMigrations() {
          return migrations
        },
      },
    })
  }

  static postgres(opts: { url: string; schema?: string }): Database {
    const { url, schema } = opts
    const pool = new PgPool({ connectionString: url })

    // Select count(*) and other pg bigints as js integer
    pgTypes.setTypeParser(pgTypes.builtins.INT8, (n) => parseInt(n, 10))

    // Setup schema usage, primarily for test parallelism (each test suite runs in its own pg schema)
    if (schema !== undefined) {
      if (!/^[a-z_]+$/i.test(schema)) {
        throw new Error(
          `Postgres schema must only contain [A-Za-z_]: ${schema}`,
        )
      }
      pool.on('connect', (client) =>
        // Shared objects such as extensions will go in the public schema
        client.query(`SET search_path TO "${schema}",public`),
      )
    }

    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool }),
    })

    return new Database(db, schema)
  }

  static mock(): MockDatabase {
    return new MockDatabase()
  }

  async close(): Promise<void> {
    await this.db.destroy()
  }

  async healthCheck(): Promise<void> {
    await sql`select 1`.execute(this.db)
  }

  async migrateToOrThrow(migration: string) {
    if (this.schema !== undefined) {
      await this.db.schema.createSchema(this.schema).ifNotExists().execute()
    }
    const { error, results } = await this.migrator.migrateTo(migration)
    if (error) {
      throw error
    }
    if (!results) {
      throw new Error('An unknown failure occurred while migrating')
    }
    return results
  }

  async migrateToLatestOrThrow() {
    if (this.schema !== undefined) {
      await this.db.schema.createSchema(this.schema).ifNotExists().execute()
    }
    const { error, results } = await this.migrator.migrateToLatest()
    if (error) {
      throw error
    }
    if (!results) {
      throw new Error('An unknown failure occurred while migrating')
    }
    return results
  }

  async validateAndAddOp(did: string, proposed: plc.Operation): Promise<void> {
    const ops = await this._opsForDid(did)
    // throws if invalid
    const { nullified, prev } = await plc.assureValidNextOp(did, ops, proposed)
    const cid = await cidForCbor(proposed)

    await this.db
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (tx) => {
        await tx
          .insertInto('operations')
          .values({
            did,
            operation: JSON.stringify(proposed),
            cid: cid.toString(),
            nullified: 0,
            createdAt: new Date().toISOString(),
          })
          .execute()

        if (nullified.length > 0) {
          const nullfiedStrs = nullified.map((cid) => cid.toString())
          await tx
            .updateTable('operations')
            .set({ nullified: 1 })
            .where('did', '=', did)
            .where('cid', 'in', nullfiedStrs)
            .execute()
        }

        // verify that the 2nd to last tx matches the proposed prev
        // otherwise rollback to prevent forks in history
        const mostRecent = await tx
          .selectFrom('operations')
          .select('cid')
          .where('did', '=', did)
          .where('nullified', '=', 0)
          .orderBy('createdAt', 'desc')
          .limit(2)
          .execute()
        const isMatch =
          (prev === null && !mostRecent[1]) ||
          (prev && prev.equals(CID.parse(mostRecent[1].cid)))
        if (!isMatch) {
          throw new ServerError(
            409,
            `Proposed prev does not match the most recent operation: ${mostRecent?.toString()}`,
          )
        }
      })
  }

  async mostRecentCid(did: string, notIncluded: CID[]): Promise<CID | null> {
    const notIncludedStr = notIncluded.map((cid) => cid.toString())

    const found = await this.db
      .selectFrom('operations')
      .select('cid')
      .where('did', '=', did)
      .where('nullified', '=', 0)
      .where('cid', 'not in', notIncludedStr)
      .orderBy('createdAt', 'desc')
      .executeTakeFirst()
    return found ? CID.parse(found.cid) : null
  }

  async opsForDid(did: string): Promise<plc.OpOrTombstone[]> {
    const ops = await this._opsForDid(did)
    return ops.map((op) => {
      if (check.is(op.operation, plc.def.createOpV1)) {
        return plc.normalizeOp(op.operation)
      }
      return op.operation
    })
  }

  async _opsForDid(did: string): Promise<plc.IndexedOperation[]> {
    const res = await this.db
      .selectFrom('operations')
      .selectAll()
      .where('did', '=', did)
      .where('nullified', '=', 0)
      .orderBy('createdAt', 'asc')
      .execute()

    return res.map((row) => ({
      did: row.did,
      operation: JSON.parse(row.operation),
      cid: CID.parse(row.cid),
      nullified: row.nullified === 1,
      createdAt: new Date(row.createdAt),
    }))
  }

  async fullExport(): Promise<Record<string, OpLogExport>> {
    const res = await this.db
      .selectFrom('operations')
      .selectAll()
      .orderBy('did')
      .orderBy('createdAt')
      .execute()
    return res.reduce((acc, cur) => {
      acc[cur.did] ??= []
      acc[cur.did].push({
        op: JSON.parse(cur.operation),
        nullified: cur.nullified === 1,
        createdAt: cur.createdAt,
      })
      return acc
    }, {} as Record<string, OpLogExport>)
  }
}

export default Database

interface OperationsTable {
  did: string
  operation: string
  cid: string
  nullified: 0 | 1
  createdAt: string
}

interface DatabaseSchema {
  operations: OperationsTable
}
