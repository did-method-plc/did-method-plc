import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Create sequence for assigning sequence numbers
  await sql`CREATE SEQUENCE plc_seq_sequence`.execute(db)

  // Add seq column (nullable)
  await db.schema.alterTable('operations').addColumn('seq', 'bigint').execute()
  // Equivalent: ALTER TABLE operations ADD COLUMN seq bigint;
  // Note: This should be a metadata-only operation, and will not require a full rewrite of the table

  // This index has two uses:
  // 1. Get sequenced ops in seq order (for /export?after=<seq>, /export/stream)
  // 2. Get unsequenced ops (seq=null) in createdAt order (for sequencing)
  await db.schema
    .createIndex('operations_seq_createdat_idx')
    .on('operations')
    .columns(['seq', 'createdAt'])
    .execute()
  // Equivalent: CREATE INDEX operations_seq_idx ON operations (seq, "createdAt");
  // Note: Probably want `CREATE INDEX CONCURRENTLY` for prod
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('operations_seq_createdat_idx').execute()
  await db.schema.alterTable('operations').dropColumn('seq').execute()
  await sql`DROP SEQUENCE plc_seq_sequence`.execute(db)
}
