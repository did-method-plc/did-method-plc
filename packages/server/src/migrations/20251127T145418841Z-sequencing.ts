import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Create sequence for assigning sequence numbers
  await sql`CREATE SEQUENCE plc_seq_sequence`.execute(db)

  // Add seq column (nullable)
  await db.schema.alterTable('operations').addColumn('seq', 'bigint').execute()
  // Equivalent: ALTER TABLE operations ADD COLUMN seq bigint;
  // Note: This should be a metadata-only operation, and will not require a full rewrite of the table

  await db.schema
    .createIndex('operations_seq_idx')
    .on('operations')
    .columns(['seq'])
    .execute()
  // Equivalent: CREATE INDEX operations_seq_idx ON operations (seq);
  // Note: Probably want `CREATE INDEX CONCURRENTLY` for prod

  // used during sequencing (most valuable when the sequencer-leader has fallen behind)
  await sql`CREATE INDEX operations_unsequenced_idx ON operations ("createdAt") WHERE seq IS NULL`.execute(
    db,
  )
  // ditto re: CONCURRENTLY

  // NOTE: the above index was initially tested as ("createdAt", cid COLLATE "C"), but the postgres query planner was not using it effectively.
  // Using a covering index of ("createdAt", cid COLLATE "C", did) might work even better, but it has not yet been tested in prod, and the existing index is working well enough.
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('operations_unsequenced_idx').execute()
  await db.schema.dropIndex('operations_seq_idx').execute()
  await db.schema.alterTable('operations').dropColumn('seq').execute()
  await sql`DROP SEQUENCE plc_seq_sequence`.execute(db)
}
