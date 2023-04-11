import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('dids')
    .addColumn('did', 'text', (col) => col.primaryKey())
    .execute()

  await db
    .insertInto('dids')
    .columns(['did'])
    .expression((qb) => qb.selectFrom('operations').select(['did']).distinct())
    .execute()
  // Migration code
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dids').execute()
  // Migration code
}
