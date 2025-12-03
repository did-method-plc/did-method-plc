import { EventEmitter } from 'events'
import Database from '../db'
import { OperationsTableEntry } from '../db/types'
import { SeqEvt } from './events'
import { seqLogger as log } from '../logger'

export interface SequencerEmitter {
  on(event: 'events', listener: (evts: SeqEvt[]) => void): this
  off(event: 'events', listener: (evts: SeqEvt[]) => void): this
  emit(event: 'events', evts: SeqEvt[]): boolean
  removeAllListeners(event?: string): this
  setMaxListeners(n: number): this
}

export type SequencerOptions = {
  pollIntervalMs?: number
  backfillDurationMs?: number
}

export class Sequencer
  extends (EventEmitter as new () => SequencerEmitter)
  implements SequencerEmitter
{
  polling = false
  lastSeen = 0
  destroyed = false
  pollInterval: NodeJS.Timeout | null = null
  pollIntervalMs: number
  catchupDurationMs: number

  constructor(public db: Database, opts: SequencerOptions = {}) {
    super()
    // note: this does not err when surpassed, just prints a warning to stderr
    this.setMaxListeners(100)
    this.pollIntervalMs = opts.pollIntervalMs ?? 50
    this.catchupDurationMs = opts.backfillDurationMs ?? 1000 * 60 * 60 * 24 * 7 // 1 week
  }

  async start(): Promise<void> {
    const curr = await this.curr()
    if (curr) {
      this.lastSeen = curr.seq ?? 0
    }

    // Poll for new seq events frequently
    this.pollInterval = setInterval(() => {
      if (!this.destroyed && !this.polling) {
        this.pollDb()
      }
    }, this.pollIntervalMs)
  }

  async curr(): Promise<OperationsTableEntry | null> {
    const result = await this.db.db
      .selectFrom('operations')
      .selectAll()
      .where('seq', 'is not', null)
      .orderBy('seq', 'desc')
      .limit(1)
      .executeTakeFirst()
    return result ?? null
  }

  async next(cursor: number): Promise<OperationsTableEntry | null> {
    const result = await this.db.db
      .selectFrom('operations')
      .selectAll()
      .where('seq', 'is not', null)
      .where('seq', '>', cursor)
      .limit(1)
      .orderBy('seq', 'asc')
      .executeTakeFirst()
    return result ?? null
  }

  async requestSeqRange(opts: {
    earliestSeq?: number
    latestSeq?: number
    limit?: number
  }): Promise<SeqEvt[]> {
    let builder = this.db.db
      .selectFrom('operations')
      .selectAll()
      .where('seq', 'is not', null)
      .orderBy('seq', 'asc')

    if (opts.earliestSeq !== undefined) {
      builder = builder.where('seq', '>', opts.earliestSeq)
    }
    if (opts.latestSeq !== undefined) {
      builder = builder.where('seq', '<=', opts.latestSeq)
    }
    if (opts.limit !== undefined) {
      builder = builder.limit(opts.limit)
    }

    const rows = await builder.execute()

    return rows.map((row) => ({
      seq: row.seq as number,
      type: 'indexed_op',
      did: row.did,
      operation: row.operation,
      cid: row.cid,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  async pollDb(): Promise<void> {
    this.polling = true
    try {
      const evts = await this.requestSeqRange({
        earliestSeq: this.lastSeen,
        limit: 1000,
      })
      if (evts.length > 0) {
        this.emit('events', evts)
        this.lastSeen = evts.at(-1)?.seq ?? this.lastSeen
      }
    } catch (err) {
      log.error({ err, lastSeen: this.lastSeen }, 'sequencer failed to poll db')
    } finally {
      this.polling = false
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    super.removeAllListeners()
  }
}
