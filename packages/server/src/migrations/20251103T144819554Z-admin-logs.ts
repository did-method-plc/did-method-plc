import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_logs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('data', 'jsonb', (col) => col.notNull())
    .addColumn('createdAt', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`current_timestamp`),
    )
    .execute()

  await db.schema
    .createIndex('admin_logs_createdat_idx')
    .on('admin_logs')
    .columns(['createdAt'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('admin_logs_createdat_idx').execute()
  await db.schema.dropTable('admin_logs').execute()
}
