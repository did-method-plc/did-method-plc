import { Kysely, Migrator, PostgresDialect, Selectable, sql } from 'kysely'
import { Pool as PgPool, types as pgTypes } from 'pg'
import { CID } from 'multiformats/cid'
import { cidForCbor } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from '../error'
import * as migrations from '../migrations'
import { DatabaseSchema, OperationsTable, PlcDatabase } from './types'
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
    const ops = await this.indexedOpsForDid(did)
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
            operation: proposed,
            cid: cid.toString(),
            nullified: false,
          })
          .execute()

        if (nullified.length > 0) {
          const nullfiedStrs = nullified.map((cid) => cid.toString())
          await tx
            .updateTable('operations')
            .set({ nullified: true })
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
          .where('nullified', '=', false)
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
      .where('nullified', '=', false)
      .where('cid', 'not in', notIncludedStr)
      .orderBy('createdAt', 'desc')
      .executeTakeFirst()
    return found ? CID.parse(found.cid) : null
  }

  async opsForDid(did: string): Promise<plc.CompatibleOpOrTombstone[]> {
    const ops = await this.indexedOpsForDid(did)
    return ops.map((op) => op.operation)
  }

  async indexedOpsForDid(
    did: string,
    includeNullified = false,
  ): Promise<plc.IndexedOperation[]> {
    let builder = this.db
      .selectFrom('operations')
      .selectAll()
      .where('did', '=', did)
      .orderBy('createdAt', 'asc')
    if (!includeNullified) {
      builder = builder.where('nullified', '=', false)
    }
    const res = await builder.execute()
    return res.map((row) => ({
      did: row.did,
      operation: row.operation,
      cid: CID.parse(row.cid),
      nullified: row.nullified,
      createdAt: row.createdAt,
    }))
  }

  async lastOpForDid(did: string): Promise<plc.CompatibleOpOrTombstone | null> {
    const res = await this.db
      .selectFrom('operations')
      .selectAll()
      .where('did', '=', did)
      .where('nullified', '=', false)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst()
    return res?.operation ?? null
  }

  async exportOps(
    count: number,
    after?: Date,
  ): Promise<Selectable<OperationsTable>[]> {
    let builder = this.db
      .selectFrom('operations')
      .selectAll()
      .orderBy('createdAt', 'desc')
      .limit(count)
    if (after) {
      builder = builder.where('createdAt', '>', after)
    }
    return builder.execute()
  }
}

export default Database
