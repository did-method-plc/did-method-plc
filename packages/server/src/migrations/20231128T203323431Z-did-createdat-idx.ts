import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex('operations_did_createdat_idx')
    .on('operations')
    .columns(['did', 'createdAt'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('operations_did_createdat_idx').execute()
}
