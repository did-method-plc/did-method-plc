import { wait } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { CloseFn, runTestServer, TestServerInfo, createDid } from './_util'
import { Database, SeqEvt } from '../src'
import { SequencerLeader } from '../src/sequencer/sequencer-leader'
import WebSocket from 'ws'

describe('/export/stream endpoint', () => {
  let server: TestServerInfo
  let close: CloseFn
  let db: Database
  let sequencerLeader: SequencerLeader
  let client: plc.Client
  let wsUrl: string

  beforeAll(async () => {
    server = await runTestServer({
      dbSchema: 'export_stream',
    })

    db = server.db
    close = server.close
    client = new plc.Client(server.url)
    wsUrl = server.url.replace('http://', 'ws://') + '/export/stream'

    // Start the sequencer leader
    sequencerLeader = new SequencerLeader(db)
    sequencerLeader.run().catch(() => {})
  })

  afterAll(async () => {
    sequencerLeader?.destroy()
    if (close) {
      await close()
    }
  })

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

  const waitForWsToMaybeClose = async (ws: WebSocket): Promise<void> => {
    return new Promise<void>((resolve) => {
      ws.on('error', () => {
        resolve()
      })
      ws.on('close', () => {
        resolve()
      })
      setTimeout(resolve, 1000)
    })
  }

  it('connects via WebSocket', async () => {
    const ws = new WebSocket(wsUrl)

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.close()
        resolve()
      })
      ws.on('error', reject)
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    })
  })

  it('streams events in real-time', async () => {
    const ws = new WebSocket(wsUrl)
    const receivedEvents: SeqEvt[] = []

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    ws.on('message', (data: Buffer) => {
      // Each WebSocket message is a complete JSON object
      receivedEvents.push(JSON.parse(data.toString()))
    })

    // Create a DID after connection is open
    await createDid(client)
    await waitForSequencing()

    // Wait for event to arrive
    await wait(200)

    ws.close()

    expect(receivedEvents.length).toBeGreaterThan(0)
    expect(receivedEvents[0].seq).toBeDefined()
    expect(receivedEvents[0].type).toBe('indexed_op')
    expect(receivedEvents[0].operation).toBeDefined()
    expect(receivedEvents[0].did).toMatch(/^did:plc:/)
  })

  it('backfills from cursor', async () => {
    // Create some events first
    await createDid(client)
    await createDid(client)
    await waitForSequencing()

    // Find the first cursor
    const { seq } = await db.db
      .selectFrom('operations')
      .select('seq')
      .where('seq', 'is not', null)
      .orderBy('seq', 'asc')
      .limit(1)
      .executeTakeFirstOrThrow()
    const cursor = seq as number

    const ws = new WebSocket(`${wsUrl}?cursor=${cursor}`)
    const receivedEvents: SeqEvt[] = []

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    ws.on('message', (data: Buffer) => {
      // Each WebSocket message is a complete JSON object
      receivedEvents.push(JSON.parse(data.toString()))
    })

    // Wait for backfill
    await wait(300)

    ws.close()

    // Should have received events after the cursor
    expect(receivedEvents.length).toBeGreaterThan(0)
    expect(receivedEvents.every((e) => e.seq > cursor)).toBe(true)
  })

  it('rejects invalid cursor parameter', async () => {
    const ws = new WebSocket(`${wsUrl}?cursor=invalid`)

    await waitForWsToMaybeClose(ws)

    // Connection should fail or close
    expect(ws.readyState).not.toBe(WebSocket.OPEN)
  })

  it('rejects negative cursor parameter', async () => {
    const ws = new WebSocket(`${wsUrl}?cursor=-1`)

    await waitForWsToMaybeClose(ws)

    expect(ws.readyState).not.toBe(WebSocket.OPEN)
  })

  it('requires websocket upgrade', async () => {
    // Try to access without upgrade header (regular HTTP)
    const response = await fetch(`${server.url}/export/stream`)
    expect(response.status).toBe(426)
  })

  it('handles multiple concurrent WebSocket connections', async () => {
    const numConnections = 5
    const connections: WebSocket[] = []
    const eventCounts: number[] = []

    // Open multiple connections
    for (let i = 0; i < numConnections; i++) {
      const ws = new WebSocket(wsUrl)
      connections.push(ws)
      eventCounts.push(0)

      ws.on('message', () => {
        eventCounts[i]++
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
      })
    }

    // Create an event
    await createDid(client)
    await waitForSequencing()

    // Wait for events to propagate
    await wait(300)

    // Close all connections
    for (const ws of connections) {
      ws.close()
    }

    // All connections should have received events
    for (const count of eventCounts) {
      expect(count).toBeGreaterThan(0)
    }
  })

  it('cleans up on client disconnect', async () => {
    const ws = new WebSocket(wsUrl)

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    // Abruptly close
    ws.terminate()

    // Create events after disconnect - server should handle gracefully
    await createDid(client)
    await waitForSequencing()

    // If we get here without errors, cleanup worked
    expect(true).toBe(true)
  })

  it('sends each event as a separate WebSocket message with valid JSON', async () => {
    const ws = new WebSocket(wsUrl)
    const messages: string[] = []

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    ws.on('message', (data: Buffer) => {
      messages.push(data.toString())
    })

    // Create events
    await createDid(client)
    await waitForSequencing()
    await wait(200)

    ws.close()

    // Verify each WebSocket message is valid JSON
    expect(messages.length).toBeGreaterThan(0)

    for (const msg of messages) {
      const parsed = JSON.parse(msg)
      expect(parsed.seq).toBeDefined()
      expect(parsed.seq).not.toBeNull()
      expect(parsed.type).toBe('indexed_op')
      expect(parsed.nullified).toBeUndefined()
    }
  })

  it('sends the same operations as /export?after=<seq>, in the same order', async () => {
    const latestSeq = await sequencerLeader.lastSeq()

    const ws = new WebSocket(`${wsUrl}?cursor=0`)
    const streamedMsgs: SeqEvt[] = []

    await new Promise<void>((resolve, reject) => {
      ws.on('error', reject)
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString())
        streamedMsgs.push(msg)
        if (msg.seq === latestSeq) {
          resolve()
        }
      })
      setTimeout(reject, 1000)
    })
    ws.close()

    expect(streamedMsgs.length).toBeGreaterThan(0)

    const exportData = await client.export() // assumes everything fits in first page

    expect(streamedMsgs.length).toEqual(exportData.length)
    for (let i = 0; i < streamedMsgs.length; i++) {
      expect(streamedMsgs[i].seq).toEqual(exportData[i].seq)
      expect(streamedMsgs[i].operation).toEqual(exportData[i].operation)
      expect(streamedMsgs[i].createdAt).toEqual(exportData[i].createdAt)
      expect(streamedMsgs[i].did).toEqual(exportData[i].did)
      expect(streamedMsgs[i].cid).toEqual(exportData[i].cid)

      // additional tests for /export format
      expect((exportData[i] as any).nullified).toBeUndefined()
      expect(exportData[i].type).toBe('indexed_op')
    }
  })

  it('rejects cursors from the future', async () => {
    const ws = new WebSocket(`${wsUrl}?cursor=99999999`)
    const closeReason = await new Promise<string>((resolve, reject) => {
      ws.on('error', reject)
      ws.on('close', (code, reason) => {
        resolve(reason.toString())
      })
      setTimeout(reject, 1000)
    })
    expect(closeReason).toBe('Cursor is from the future')
  })
})
