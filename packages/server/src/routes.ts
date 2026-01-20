import { CID } from 'multiformats/cid'
import express from 'express'
import { WebSocket } from 'ws'
import * as plc from '@did-plc/lib'
import { ServerError } from './error'
import { AppContext } from './context'
import { assertValidIncomingOp } from './constraints'
import { timingSafeStringEqual } from './util'
import { Outbox, OutboxError } from './sequencer'

export const createRouter = (ctx: AppContext): express.Router => {
  const router = express.Router()

  router.get('/', async function (req, res) {
    // HTTP temporary redirect to project homepage
    res.redirect(302, 'https://web.plc.directory')
  })

  router.get('/_health', async function (req, res) {
    const { db, version } = ctx
    try {
      await db.healthCheck()
    } catch (err) {
      req.log.error(err, 'failed health check')
      return res.status(503).send({ version, error: 'Service Unavailable' })
    }
    res.send({ version })
  })

  // Export ops in the form of paginated json lines
  router.get('/export', async function (req, res) {
    const countParam =
      typeof req.query.count === 'string' ? req.query.count : undefined
    const parsedCount = countParam ? parseInt(countParam, 10) : 1000
    if (isNaN(parsedCount) || parsedCount < 1) {
      throw new ServerError(400, 'Invalid count parameter')
    }
    const count = Math.min(parsedCount, 1000)

    const afterParam =
      typeof req.query.after === 'string' ? req.query.after : undefined
    const isNumeric = afterParam && /^\d+$/.test(afterParam)

    let ops: plc.ExportedOpWithSeq[] | plc.ExportedOp[]
    if (isNumeric) {
      // after is integer seq
      const after = parseInt(afterParam, 10)
      if (isNaN(after) || after < 0) {
        throw new ServerError(400, 'Invalid after parameter')
      }
      ops = await ctx.db.exportOpsSeq(count, after)
    } else {
      // after is timestamp
      const after = afterParam ? new Date(afterParam) : undefined
      if (after !== undefined && isNaN(after.getTime())) {
        throw new ServerError(400, 'Invalid after parameter')
      }
      ops = await ctx.db.exportOps(count, after)
    }

    res.setHeader('content-type', 'application/jsonlines')
    res.status(200)
    for (let i = 0; i < ops.length; i++) {
      if (i > 0) {
        res.write('\n')
      }
      const line = JSON.stringify(ops[i])
      res.write(line)
    }
    res.end()
  })

  // Stream sequenced operations over WebSocket
  router.get('/export/stream', async function (req, _res) {
    if (!req.headers.upgrade || !req.ws) {
      throw new ServerError(426, 'upgrade required')
    }

    const cursorParam =
      typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined
    if (cursor !== undefined && (isNaN(cursor) || cursor < 0)) {
      throw new ServerError(400, 'Invalid cursor parameter')
    }

    req.ws.handled = true
    ctx.wss.handleUpgrade(
      req,
      req.ws.socket,
      req.ws.head,
      async function (ws: WebSocket) {
        const abortController = new AbortController()
        const outbox = new Outbox(ctx.sequencer)

        ws.on('close', () => {
          abortController.abort()
        })

        ws.on('error', (err) => {
          req.log.error({ err }, 'websocket error')
          abortController.abort()
        })

        try {
          for await (const evt of outbox.events(
            cursor,
            abortController.signal,
          )) {
            if (ws.readyState !== WebSocket.OPEN) {
              break
            }
            // Note: each event is sent in a separate websocket message
            ws.send(JSON.stringify(evt))
          }
        } catch (err) {
          if (err instanceof OutboxError) {
            // consumer too slow, or stale cursor
            ws.close(1000, err.message)
          }
          if (!abortController.signal.aborted) {
            req.log.error({ err }, 'error streaming events')
          }
        } finally {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close()
          }
        }
      },
    )
  })

  // Bulk lookup of multiple DIDs
  const MAX_BULK_DIDS = 1000
  router.post('/dids', async function (req, res) {
    const { dids } = req.body
    if (!Array.isArray(dids)) {
      throw new ServerError(400, 'dids must be an array')
    }
    if (dids.length === 0) {
      throw new ServerError(400, 'dids array must not be empty')
    }
    if (dids.length > MAX_BULK_DIDS) {
      throw new ServerError(400, `Too many DIDs (max ${MAX_BULK_DIDS})`)
    }

    // Validate all DIDs are strings with correct prefix
    for (const did of dids) {
      if (typeof did !== 'string') {
        throw new ServerError(400, 'Each DID must be a string')
      }
      if (!did.startsWith('did:plc:')) {
        throw new ServerError(400, `Invalid DID format: ${did}`)
      }
    }

    res.setHeader('content-type', 'application/jsonlines')
    res.status(200)

    // Stream results from database, tracking found DIDs
    const requestedDids = new Set(dids)
    const foundDids = new Set<string>()
    let first = true

    for await (const { did, operation } of ctx.db.streamLastOpsForDids(dids)) {
      if (!first) res.write('\n')
      first = false
      foundDids.add(did)

      const data = plc.opToData(did, operation)
      if (data === null) {
        // Tombstoned
        res.write(JSON.stringify({ did, document: null, tombstoned: true }))
      } else {
        const doc = plc.formatDidDoc(data)
        res.write(JSON.stringify({ did, document: doc }))
      }
    }

    // Emit notFound entries for DIDs not in database
    for (const did of requestedDids) {
      if (!foundDids.has(did)) {
        if (!first) res.write('\n')
        first = false
        res.write(JSON.stringify({ did, document: null, notFound: true }))
      }
    }

    res.end()
  })

  // Get data for a DID document
  router.get('/:did', async function (req, res) {
    const { did } = req.params
    const last = await ctx.db.lastOpForDid(did)
    if (!last) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    const data = plc.opToData(did, last)
    if (data === null) {
      throw new ServerError(404, `DID not available: ${did}`)
    }
    const doc = await plc.formatDidDoc(data)
    res.type('application/did+ld+json')
    res.send(JSON.stringify(doc))
  })

  // Get data for a DID document
  router.get('/:did/data', async function (req, res) {
    const { did } = req.params
    const last = await ctx.db.lastOpForDid(did)
    if (!last) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    const data = plc.opToData(did, last)
    if (data === null) {
      throw new ServerError(404, `DID not available: ${did}`)
    }
    res.json(data)
  })

  // Get operation log for a DID
  router.get('/:did/log', async function (req, res) {
    const { did } = req.params
    const log = await ctx.db.opsForDid(did)
    if (log.length === 0) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    res.json(log)
  })

  // Get operation log for a DID
  router.get('/:did/log/audit', async function (req, res) {
    const { did } = req.params
    const ops = await ctx.db.indexedOpsForDid(did, true)
    if (ops.length === 0) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    const log = ops.map((op) => ({
      ...op,
      cid: op.cid.toString(),
      createdAt: op.createdAt.toISOString(),
    }))

    res.json(log)
  })

  // Get the most recent operation in the log for a DID
  router.get('/:did/log/last', async function (req, res) {
    const { did } = req.params
    const last = await ctx.db.lastOpForDid(did)
    if (!last) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    res.json(last)
  })

  // Update or create a DID doc
  router.post('/:did', async function (req, res) {
    const { did } = req.params
    const op = req.body
    assertValidIncomingOp(op)
    await ctx.db.validateAndAddOp(did, op, new Date())
    res.sendStatus(200)
  })

  // We only have one admin endpoint, so an auth middleware would probably be overkill
  router.post('/admin/removeInvalidOps', async function (req, res) {
    const { adminSecret, did, cid } = req.body

    // admin auth
    if (!ctx.adminSecret) {
      throw new ServerError(401, 'admin secret has not been configured')
    }
    if (!timingSafeStringEqual(adminSecret, ctx.adminSecret)) {
      throw new ServerError(401, 'invalid admin secret')
    }

    const removedOps = await ctx.db.removeInvalidOps(did, cid)
    res.json(removedOps)
  })

  return router
}

export default createRouter
