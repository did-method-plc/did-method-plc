import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('operations_new')
    .addColumn('did', 'text', (col) => col.notNull())
    .addColumn('operation', 'jsonb', (col) => col.notNull())
    .addColumn('cid', 'text', (col) => col.notNull())
    .addColumn('nullified', 'boolean', (col) => col.notNull())
    .addColumn('createdAt', 'timestamptz', (col) =>
      col.defaultTo(sql`current_timestamp`),
    )
    .addPrimaryKeyConstraint('operations_primary_key', ['did', 'cid'])
    .execute()

  const dump = await db.selectFrom('operations').selectAll().execute()
  const vals = dump.map((row) => ({
    did: row.did,
    operation: row.operation,
    cid: row.cid,
    nullified: row.nullified === 1 ? true : false,
    createdAt: row.createdAt,
  }))

  await db.insertInto('operations_new').values(vals).execute()

  await db.schema.dropTable('operations').execute()

  await db.schema.alterTable('operations_new').renameTo('operations').execute()

  await db.schema
    .createIndex('operations_createdAt_index')
    .on('operations')
    .column('createdAt')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('operations_new')
    .addColumn('did', 'varchar', (col) => col.notNull())
    .addColumn('operation', 'text', (col) => col.notNull())
    .addColumn('cid', 'varchar', (col) => col.notNull())
    .addColumn('nullified', 'int2', (col) => col.defaultTo(0))
    .addColumn('createdAt', 'varchar', (col) => col.notNull())
    .addPrimaryKeyConstraint('primary_key', ['did', 'cid'])
    .execute()

  const dump = await db.selectFrom('operations').selectAll().execute()
  const vals = dump.map((row) => ({
    did: row.did,
    operation: JSON.stringify(row.operation),
    cid: row.cid,
    nullified: row.nullified ? 1 : 0,
    createdAt: row.createdAt.toISOString(),
  }))

  await db.insertInto('operations_new').values(vals).execute()

  await db.schema.dropIndex('operations_createdAt_index').execute()
  await db.schema.dropTable('operations').execute()

  await db.schema.alterTable('operations_new').renameTo('operations').execute()
}
