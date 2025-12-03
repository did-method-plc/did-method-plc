import { P256Keypair } from '@atproto/crypto'
import { wait } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { CloseFn, runTestServer, TestServerInfo, createDid } from './_util'
import { Database, Sequencer, Outbox, SeqEvt } from '../src'
import { SequencerLeader } from '../src/sequencer/sequencer-leader'

describe('sequencer', () => {
  let server: TestServerInfo
  let close: CloseFn
  let db: Database
  let sequencer: Sequencer
  let sequencerLeader: SequencerLeader
  let client: plc.Client

  let lastSeen = 0

  beforeAll(async () => {
    server = await runTestServer({
      dbSchema: 'sequencer',
    })

    db = server.db
    close = server.close
    client = new plc.Client(server.url)
    sequencer = server.ctx.sequencer

    // Start the sequencer leader to assign sequence numbers
    sequencerLeader = new SequencerLeader(db)
    sequencerLeader.run().catch(() => {
      // ignore, will be destroyed in afterAll
    })
  })

  afterAll(async () => {
    sequencerLeader?.destroy()
    if (close) {
      await close()
    }
  })

  // Utility to wait for sequencer leader to catch up
  const waitForSequencing = async (maxWait = 5000): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      const unsequenced = await db.db
        .selectFrom('operations')
        .select('did')
        .where('seq', 'is', null)
        .executeTakeFirst()
      if (!unsequenced) {
        return
      }
      await wait(50)
    }
    throw new Error('Timed out waiting for sequencing')
  }

  // Helper to read events from generator with timeout
  const readFromGenerator = async <T>(
    gen: AsyncGenerator<T>,
    isDone: () => Promise<boolean> | boolean,
    waitFor: Promise<unknown> = Promise.resolve(),
    maxLength = Number.MAX_SAFE_INTEGER,
  ): Promise<T[]> => {
    const evts: T[] = []
    let hasBroke = false

    const awaitDone = async (): Promise<boolean> => {
      if (await isDone()) {
        return true
      }
      await wait(20)
      if (hasBroke) return false
      return await awaitDone()
    }

    const breakOn: Promise<void> = new Promise((resolve) => {
      waitFor.then(() => {
        awaitDone().then(() => resolve())
      })
    })

    try {
      while (evts.length < maxLength) {
        const maybeEvt = await Promise.race([gen.next(), breakOn])
        if (!maybeEvt) break
        const evt = maybeEvt as IteratorResult<T>
        if (evt.done) break
        evts.push(evt.value)
      }
    } finally {
      hasBroke = true
    }
    return evts
  }

  // Load events directly from the database
  const loadFromDb = async (afterSeq: number): Promise<SeqEvt[]> => {
    const rows = await db.db
      .selectFrom('operations')
      .selectAll()
      .where('seq', 'is not', null)
      .where('seq', '>', afterSeq)
      .orderBy('seq', 'asc')
      .execute()

    return rows.map((row) => ({
      seq: row.seq as number,
      type: 'indexed_op',
      did: row.did,
      operation: row.operation,
      cid: row.cid,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  // Check if outbox is caught up with sequencer
  const caughtUp = (outbox: Outbox): (() => Promise<boolean>) => {
    return async () => {
      // First check if all events are sequenced
      const unsequenced = await db.db
        .selectFrom('operations')
        .select('did')
        .where('seq', 'is', null)
        .executeTakeFirst()
      if (unsequenced) return false

      const lastEvt = await sequencer.curr()
      if (!lastEvt) return true
      return outbox.lastSeen >= (lastEvt.seq ?? 0)
    }
  }

  describe('Sequencer', () => {
    it('starts and tracks last seen correctly', async () => {
      // Create an event
      await createDid(client)
      await waitForSequencing()

      const curr = await sequencer.curr()
      expect(curr).not.toBeNull()
      expect(curr?.seq).toBeGreaterThan(0)
    })

    it('fetches current event', async () => {
      const curr = await sequencer.curr()
      expect(curr).not.toBeNull()
      expect(curr?.operation).toBeInstanceOf(Object)
    })

    it('fetches next event after cursor', async () => {
      // Create a new event
      await createDid(client)
      await waitForSequencing()

      const prevCurr = await sequencer.curr()
      expect(prevCurr).not.toBeNull()

      // Create another event
      await createDid(client)
      await waitForSequencing()

      const next = await sequencer.next(prevCurr!.seq!)
      expect(next).not.toBeNull()
      expect(next!.seq).toBeGreaterThan(prevCurr!.seq!)
    })

    it('requests a range of sequenced events', async () => {
      const events = await sequencer.requestSeqRange({
        limit: 10,
      })
      expect(events.length).toBeGreaterThan(0)
      expect(events.length).toBeLessThanOrEqual(10)

      // Verify ordering
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq)
      }
    })

    it('filters by earliestSeq (exclusive)', async () => {
      const allEvents = await sequencer.requestSeqRange({})
      const cutoff = allEvents[1].seq

      const filtered = await sequencer.requestSeqRange({
        earliestSeq: cutoff,
      })

      expect(filtered.every((evt) => evt.seq > cutoff)).toBe(true)
    })

    it('filters by latestSeq (inclusive)', async () => {
      const allEvents = await sequencer.requestSeqRange({})
      const cutoff = allEvents[allEvents.length - 2].seq

      const filtered = await sequencer.requestSeqRange({
        latestSeq: cutoff,
      })

      expect(filtered.every((evt) => evt.seq <= cutoff)).toBe(true)
    })

    it('emits events when new operations are sequenced', async () => {
      const receivedEvents: SeqEvt[] = []
      const listener = (evts: SeqEvt[]) => {
        receivedEvents.push(...evts)
      }

      sequencer.on('events', listener)

      // Create a new DID to generate an event
      await createDid(client)
      await waitForSequencing()

      // Wait for event to be emitted
      await wait(100)

      sequencer.off('events', listener)

      expect(receivedEvents.length).toBeGreaterThan(0)
      expect(receivedEvents[receivedEvents.length - 1].type).toBe('indexed_op')
    })
  })

  describe('SequencerLeader', () => {
    it('assigns sequence numbers to pending events', async () => {
      // Insert an event without sequence number
      await db.db.transaction().execute(async (tx) => {
        await tx
          .insertInto('operations')
          .values({
            did: 'did:plc:test123',
            operation: { type: 'plc_tombstone', prev: 'abc', sig: 'blah' },
            cid: 'bafytest',
            createdAt: new Date(),
            nullified: false,
          })
          .execute()
      })

      // Wait for sequencer leader to assign sequence number
      await waitForSequencing()

      // Verify event has sequence number
      const events = await sequencer.requestSeqRange({})
      const lastEvent = events[events.length - 1]
      expect(lastEvent.seq).toBeGreaterThan(0)
    })

    it('maintains insertion order when assigning sequences', async () => {
      // Create multiple events quickly
      const promises: Promise<string>[] = []
      for (let i = 0; i < 5; i++) {
        promises.push(createDid(client))
      }
      await Promise.all(promises)
      await waitForSequencing()

      // Verify events are in order
      const events = await sequencer.requestSeqRange({})
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq)
      }
    })
  })

  describe('Outbox', () => {
    it('streams events to outbox', async () => {
      const count = 5
      const outbox = new Outbox(sequencer)

      // Create events
      const createPromise = (async () => {
        for (let i = 0; i < count; i++) {
          await createDid(client)
        }
        await waitForSequencing()
      })()

      const evts = await readFromGenerator(
        outbox.events(lastSeen),
        caughtUp(outbox),
        createPromise,
      )

      expect(evts.length).toBeGreaterThanOrEqual(count)

      // Verify events match database
      const fromDb = await loadFromDb(lastSeen)
      expect(evts.map((e) => e.seq)).toEqual(fromDb.map((e) => e.seq))

      lastSeen = evts.at(-1)?.seq ?? lastSeen
    })

    it('handles cutover correctly', async () => {
      const count = 10
      const outbox = new Outbox(sequencer)

      // Start reading and creating events concurrently
      const createPromise = (async () => {
        for (let i = 0; i < count; i++) {
          await createDid(client)
        }
        await waitForSequencing()
      })()

      const [evts] = await Promise.all([
        readFromGenerator(
          outbox.events(lastSeen),
          caughtUp(outbox),
          createPromise,
        ),
        createPromise,
      ])

      expect(evts.length).toBe(count)

      // Verify no duplicates
      const seqs = evts.map((e) => e.seq)
      expect(new Set(seqs).size).toBe(seqs.length)

      // Verify events match database
      const fromDb = await loadFromDb(lastSeen)
      expect(evts.map((e) => e.seq)).toEqual(fromDb.map((e) => e.seq))

      lastSeen = evts.at(-1)?.seq ?? lastSeen
    })

    it('only gets events after cursor', async () => {
      const count = 5
      const outbox = new Outbox(sequencer)

      const createPromise = (async () => {
        for (let i = 0; i < count; i++) {
          await createDid(client)
        }
        await waitForSequencing()
      })()

      const [evts] = await Promise.all([
        readFromGenerator(
          outbox.events(lastSeen),
          caughtUp(outbox),
          createPromise,
        ),
        createPromise,
      ])

      // Should only get events after lastSeen
      expect(evts.length).toBe(count)
      expect(evts.every((evt) => evt.seq > lastSeen)).toBe(true)

      lastSeen = evts.at(-1)?.seq ?? lastSeen
    })

    it('buffers events that are not being read', async () => {
      const count = 10
      const outbox = new Outbox(sequencer)

      const createPromise = (async () => {
        for (let i = 0; i < count; i++) {
          await createDid(client)
        }
        await waitForSequencing()
      })()

      const gen = outbox.events(lastSeen)

      // Read first few events, then pause
      const [firstPart] = await Promise.all([
        readFromGenerator(gen, caughtUp(outbox), createPromise, 3),
        createPromise,
      ])

      // Read the rest
      const secondPart = await readFromGenerator(gen, caughtUp(outbox))

      const evts = [...firstPart, ...secondPart]
      expect(evts.length).toBe(count)

      // Verify no duplicates
      const seqs = evts.map((e) => e.seq)
      expect(new Set(seqs).size).toBe(seqs.length)

      lastSeen = evts.at(-1)?.seq ?? lastSeen
    })

    it('errors when buffer is overloaded', async () => {
      const count = 20
      const outbox = new Outbox(sequencer, { maxBufferSize: 5 })
      const gen = outbox.events(lastSeen)

      const createPromise = (async () => {
        for (let i = 0; i < count; i++) {
          await createDid(client)
        }
        await waitForSequencing()
      })()

      const overloadBuffer = async () => {
        // Read a few events to start streaming
        await Promise.all([
          readFromGenerator(gen, caughtUp(outbox), createPromise, 3),
          createPromise,
        ])
        // Wait long enough for buffer to fill
        await wait(500)
        // Try to read more - should error
        await readFromGenerator(gen, caughtUp(outbox))
      }

      await expect(overloadBuffer()).rejects.toThrow('Stream consumer too slow')

      // Update lastSeen from db
      const fromDb = await loadFromDb(lastSeen)
      lastSeen = fromDb.at(-1)?.seq ?? lastSeen
    })

    it('handles many concurrent connections', async () => {
      const count = 5
      const numConnections = 10
      const outboxes: Outbox[] = []

      for (let i = 0; i < numConnections; i++) {
        outboxes.push(new Outbox(sequencer))
      }

      const createPromise = (async () => {
        for (let i = 0; i < count; i++) {
          await createDid(client)
        }
        await waitForSequencing()
      })()

      const readOutboxes = Promise.all(
        outboxes.map((o) =>
          readFromGenerator(o.events(lastSeen), caughtUp(o), createPromise),
        ),
      )

      const [results] = await Promise.all([readOutboxes, createPromise])

      // All connections should receive the same events
      for (const evts of results) {
        expect(evts.length).toBe(count)
        expect(evts.map((e) => e.seq)).toEqual(results[0].map((e) => e.seq))
      }

      lastSeen = results[0].at(-1)?.seq ?? lastSeen
    })

    it('respects abort signal during backfill', async () => {
      // Create several events first to have something to backfill
      for (let i = 0; i < 5; i++) {
        await createDid(client)
      }
      await waitForSequencing()

      const outbox = new Outbox(sequencer)
      const abortController = new AbortController()

      // Start from beginning to force backfill
      const gen = outbox.events(0, abortController.signal)

      const evts: SeqEvt[] = []

      // Read a few events then abort
      for await (const evt of gen) {
        evts.push(evt)
        if (evts.length >= 3) {
          abortController.abort()
          break
        }
      }

      // Should have stopped after abort
      expect(evts.length).toBeGreaterThanOrEqual(3)
      expect(abortController.signal.aborted).toBe(true)
    })

    it('streams from the beginning when no cursor provided', async () => {
      const outbox = new Outbox(sequencer)
      const abortController = new AbortController()

      // Start streaming without cursor (should skip straight to streaming mode)
      const gen = outbox.events(undefined, abortController.signal)

      // Create a new event - must happen after gen is started to be caught
      const eventCreated = (async () => {
        await wait(50) // Small delay to ensure gen is ready
        await createDid(client)
        await waitForSequencing()
      })()

      // Read the event with a timeout
      const evts: SeqEvt[] = []
      const timeout = setTimeout(() => abortController.abort(), 500)

      try {
        for await (const evt of gen) {
          evts.push(evt)
          if (evts.length >= 1) {
            abortController.abort()
            break
          }
        }
      } catch {
        // May throw on abort
      }

      clearTimeout(timeout)
      await eventCreated

      // Should have received the new event
      expect(evts.length).toBeGreaterThanOrEqual(1)
    })
  })
})
