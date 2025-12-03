import { AsyncBuffer, AsyncBufferFullError } from '@atproto/common'
import { Sequencer } from './sequencer'
import { SeqEvt } from './events'

export type OutboxOpts = {
  maxBufferSize: number
}

export class OutboxError extends Error {
  constructor(msg: string) {
    super(msg)
    Object.setPrototypeOf(this, OutboxError.prototype)
  }
}

export class Outbox {
  private caughtUp = false
  lastSeen = -1

  cutoverBuffer: SeqEvt[]
  outBuffer: AsyncBuffer<SeqEvt>

  constructor(public sequencer: Sequencer, opts: Partial<OutboxOpts> = {}) {
    const { maxBufferSize = 500 } = opts
    this.cutoverBuffer = []
    this.outBuffer = new AsyncBuffer<SeqEvt>(maxBufferSize)
  }

  // Event stream occurs in 3 phases:
  // 1. Backfill events: events that have been added to the DB since the last connection.
  //    The outbox is not yet listening for new events from the sequencer
  // 2. Cutover: the outbox has caught up with where the sequencer is,
  //    but the sequencer might be halfway through sending updates.
  //    We start accepting events in a buffer while making our own request to ensure we're caught up.
  //    We then dedupe the query & buffer & stream events in order
  // 3. Streaming: we're all caught up, so the sequencer outputs events and we immediately yield them
  async *events(
    backfillCursor?: number,
    signal?: AbortSignal,
  ): AsyncGenerator<SeqEvt> {
    // Phase 1: Backfill historical events
    if (backfillCursor !== undefined) {
      const [next, curr] = await Promise.all([
        this.sequencer.next(backfillCursor),
        this.sequencer.curr(),
      ])
      if (backfillCursor > (curr?.seq ?? 0)) {
        throw new OutboxError('Cursor is from the future')
      }
      const backfillTime = new Date(
        Date.now() - this.sequencer.catchupDurationMs,
      )
      if (next && next.createdAt < backfillTime) {
        throw new OutboxError('Cursor too old for streaming')
      }

      for await (const evt of this.getBackfill(backfillCursor)) {
        if (signal?.aborted) return
        this.lastSeen = evt.seq
        yield evt
      }
    } else {
      // If not backfilling, skip straight to streaming
      this.caughtUp = true
    }

    // Stream updates from sequencer, buffering them during cutover
    const addToBuffer = (evts: SeqEvt[]) => {
      if (this.caughtUp) {
        this.outBuffer.pushMany(evts)
      } else {
        this.cutoverBuffer = [...this.cutoverBuffer, ...evts]
      }
    }

    if (!signal?.aborted) {
      this.sequencer.on('events', addToBuffer)
    }
    signal?.addEventListener('abort', () =>
      this.sequencer.off('events', addToBuffer),
    )

    // Phase 2: Cutover
    const cutover = async () => {
      if (backfillCursor !== undefined) {
        const cutoverEvts = await this.sequencer.requestSeqRange({
          earliestSeq: this.lastSeen > -1 ? this.lastSeen : backfillCursor,
        })
        this.outBuffer.pushMany(cutoverEvts)
        // Don't worry about dupes, we ensure order on yield
        this.outBuffer.pushMany(this.cutoverBuffer)
        this.caughtUp = true
        this.cutoverBuffer = []
      } else {
        this.caughtUp = true
      }
    }
    cutover()

    // Phase 3: Stream all events in order, deduplicating on yield
    while (true) {
      try {
        for await (const evt of this.outBuffer.events()) {
          if (signal?.aborted) return
          if (evt.seq > this.lastSeen) {
            this.lastSeen = evt.seq
            yield evt
          }
        }
      } catch (err) {
        if (err instanceof AsyncBufferFullError) {
          throw new OutboxError('Stream consumer too slow')
        } else {
          throw err
        }
      }
    }
  }

  // Yields only historical events
  async *getBackfill(backfillCursor: number): AsyncGenerator<SeqEvt> {
    const PAGE_SIZE = 500
    while (true) {
      const evts = await this.sequencer.requestSeqRange({
        earliestSeq: this.lastSeen > -1 ? this.lastSeen : backfillCursor,
        limit: PAGE_SIZE,
      })
      for (const evt of evts) {
        yield evt
      }
      // If we're within half a page of the sequencer, switch to cutover
      const seqCursor = this.sequencer.lastSeen ?? -1
      if (seqCursor - this.lastSeen < PAGE_SIZE / 2) break
      if (evts.length < 1) break
    }
  }
}

export default Outbox
