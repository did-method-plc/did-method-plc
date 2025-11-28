import { Leader } from '../db/leader'
import Database from '../db'
import { sql } from 'kysely'
import { PLC_SEQ_SEQUENCE } from '../db/types'

const SEQUENCER_LEADER_ID = 1100

export type SequencerLeaderOptions = {
  pollIntervalMs?: number
}

export class SequencerLeader {
  leader: Leader
  destroyed = false
  pollIntervalMs: number

  constructor(public db: Database, opts: SequencerLeaderOptions = {}) {
    this.leader = new Leader(SEQUENCER_LEADER_ID, db)
    this.pollIntervalMs = opts.pollIntervalMs ?? 50
  }

  async run(): Promise<{ ran: boolean }> {
    return this.leader.run(async ({ signal }) => {
      // Poll frequently
      while (!(signal.aborted || this.destroyed)) {
        await this.sequenceOutgoing()
        await wait(this.pollIntervalMs)
      }
    })
  }

  async sequenceOutgoing(): Promise<void> {
    // Assign seq numbers to all pending events in insertion order
    await this.db.db
      .updateTable('operations')
      .from((qb) =>
        qb
          .selectFrom('operations')
          .select([
            'did as update_did',
            'cid as update_cid',
            sql<number>`nextval(${sql.literal(PLC_SEQ_SEQUENCE)})`.as(
              'update_seq',
            ),
          ])
          .where('seq', 'is', null)
          .orderBy('createdAt', 'asc')
          .orderBy(sql`cid COLLATE "C"`, 'asc')
          .limit(1000) // Prevent too much getting sequenced in one go - maybe needs tweaking?
          .as('update'),
      )
      .set({
        seq: sql`update_seq::bigint`,
      })
      .whereRef('did', '=', 'update_did')
      .whereRef('cid', '=', 'update_cid')
      .execute()
  }

  destroy(): void {
    this.destroyed = true
    this.leader.destroy()
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
