import { EventEmitter } from 'events'
import { OperationsTableEntry, PlcDatabase } from '../db/types'
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

export class Sequencer extends EventEmitter implements SequencerEmitter {
  polling = false
  lastSeen = 0
  destroyed = false
  pollInterval: NodeJS.Timeout | null = null
  pollIntervalMs: number
  catchupDurationMs: number

  constructor(readonly db: PlcDatabase, opts: SequencerOptions = {}) {
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
    return this.db.curr()
  }

  async next(cursor: number): Promise<OperationsTableEntry | null> {
    return this.db.next(cursor)
  }

  async requestSeqRange(opts: {
    earliestSeq?: number
    latestSeq?: number
    limit?: number
  }): Promise<SeqEvt[]> {
    return this.db.requestSeqRange(opts)
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
