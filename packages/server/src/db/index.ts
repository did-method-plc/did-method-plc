import { Kysely, Migrator, PostgresDialect, sql } from 'kysely'
import { Pool as PgPool, types as pgTypes } from 'pg'
import { CID } from 'multiformats/cid'
import { cidForCbor } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from '../error'
import * as migrations from '../migrations'
import { DatabaseSchema, PlcDatabase } from './types'
import MockDatabase from './mock'
import { enforceOpsRateLimit } from '../constraints'

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

  static postgres(opts: PgOptions): Database {
    const { schema } = opts
    const pool = new PgPool({
      connectionString: opts.url,
      max: opts.poolSize,
      maxUses: opts.poolMaxUses,
      idleTimeoutMillis: opts.poolIdleTimeoutMs,
    })

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

  async validateAndAddOp(
    did: string,
    proposed: plc.CompatibleOpOrTombstone,
    proposedDate: Date,
  ): Promise<void> {
    const ops = await this.indexedOpsForDid(did)
    // throws if invalid
    const { nullified, prev } = await plc.assureValidNextOp(
      did,
      ops,
      proposed,
      proposedDate,
    )
    // do not enforce rate limits on recovery operations to prevent DDOS by a bad actor
    if (nullified.length === 0) {
      enforceOpsRateLimit(ops)
    }

    const cid = await cidForCbor(proposed)

    await this.db.transaction().execute(async (tx) => {
      // grab a row lock on user table
      const userLock = await tx
        .selectFrom('dids')
        .forUpdate()
        .selectAll()
        .where('did', '=', did)
        .executeTakeFirst()

      if (!userLock) {
        await tx.insertInto('dids').values({ did }).execute()
      }

      await tx
        .insertInto('operations')
        .values({
          did,
          operation: proposed,
          cid: cid.toString(),
          nullified: false,
          createdAt: proposedDate,
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

  async exportOps(count: number, after?: Date): Promise<plc.ExportedOp[]> {
    // Note: this may include unsequenced ops (seq=null)
    let builder = this.db
      .selectFrom('operations')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .orderBy(sql`cid COLLATE "C"`, 'asc')
      .limit(count)
    if (after) {
      builder = builder.where('createdAt', '>', after)
    }
    const res = await builder.execute()
    return res.map((row) => ({
      ...row,
      seq: undefined,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  async exportOpsSeq(
    count: number,
    after: number,
  ): Promise<plc.ExportedOpWithSeq[]> {
    const res = await this.db
      .selectFrom('operations')
      .selectAll()
      .orderBy('seq', 'asc')
      .where('seq', '>', after) // Note: this implicitly excludes seq=null
      .limit(count)
      .execute()

    return res.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  async removeInvalidOps(
    did: string,
    cid: string,
  ): Promise<plc.CompatibleOpOrTombstone[]> {
    const invalidOps = await this.db.transaction().execute(async (tx) => {
      // grab a row lock on user table
      const userLock = await tx
        .selectFrom('dids')
        .forUpdate()
        .selectAll()
        .where('did', '=', did)
        .executeTakeFirst()

      if (!userLock) {
        throw new ServerError(400, 'did does not exist')
      }

      const ops = await this.indexedOpsForDid(did, true)
      const maybeInvalidOpIdx = ops.findIndex((op) => op.cid.toString() === cid)
      if (maybeInvalidOpIdx === -1) {
        throw new ServerError(400, 'operation does not exist')
      }

      const maybeInvalidOp = ops[maybeInvalidOpIdx]
      const opsBefore = ops.slice(0, maybeInvalidOpIdx)
      if (opsBefore.some((op) => op.nullified)) {
        // handling this would require a more complex implementation, fingers crossed we won't ever need it
        throw new ServerError(
          400,
          'removing ops from DIDs with prior nullifications is not currently supported',
        )
      }

      let opIsValid: boolean
      try {
        const schemaValidOp = plc.def.indexedOperation.parse(maybeInvalidOp)
        await plc.assureValidNextOp(
          did,
          opsBefore,
          schemaValidOp.operation,
          schemaValidOp.createdAt,
        )
        opIsValid = true
      } catch {
        opIsValid = false
      }
      if (opIsValid) {
        throw new ServerError(400, 'valid operations cannot be removed')
      }

      // remove the invalid op, and any that came after it
      const invalidOps = ops.slice(maybeInvalidOpIdx)
      for (const op of invalidOps) {
        await tx
          .deleteFrom('operations')
          .where('did', '=', op.did)
          .where('cid', '=', op.cid.toString())
          .executeTakeFirst()

        await tx
          .insertInto('admin_logs')
          .values({
            type: 'removeInvalidOps',
            data: {
              did: op.did,
              cid: op.cid.toString(),
            },
          })
          .execute()
      }

      return invalidOps
    })

    // return a copy of the invalid ops
    return invalidOps.map((op) => op.operation)
  }
}

export type PgOptions = {
  url: string
  schema?: string
  poolSize?: number
  poolMaxUses?: number
  poolIdleTimeoutMs?: number
}

export default Database
