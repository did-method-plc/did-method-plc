import express from 'express'
import { sql } from 'kysely'
import { check } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from './error'
import { AppContext } from './context'

export const createRouter = (ctx: AppContext): express.Router => {
  const router = express.Router()

  router.get('/_health', async function (req, res) {
    const { db, version } = ctx
    try {
      await sql`select 1`.execute(db.db)
    } catch (err) {
      req.log.error(err, 'failed health check')
      return res.status(503).send({ version, error: 'Service Unavailable' })
    }
    res.send({ version })
  })

  // @TODO paginate & test this
  router.get('/export', async function (req, res) {
    const fullExport = await ctx.db.fullExport()
    res.setHeader('content-type', 'application/jsonlines')
    res.status(200)
    for (const [did, ops] of Object.entries(fullExport)) {
      const line = JSON.stringify({ did, ops })
      res.write(line)
      res.write('\n')
    }
    res.end()
  })

  // Get data for a DID document
  router.get('/:did', async function (req, res) {
    const { did } = req.params
    const log = await ctx.db.opsForDid(did)
    if (log.length === 0) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    const data = await plc.validateOperationLog(did, log)
    if (data === null) {
      throw new ServerError(404, `DID not available: ${did}`)
    }
    const doc = await plc.formatDidDoc(data)
    res.type('application/did+ld+json')
    res.send(JSON.stringify(doc))
  })

  // Get data for a DID document
  router.get('/data/:did', async function (req, res) {
    const { did } = req.params
    const log = await ctx.db.opsForDid(did)
    if (log.length === 0) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    const data = await plc.validateOperationLog(did, log)
    if (data === null) {
      throw new ServerError(404, `DID not available: ${did}`)
    }
    res.json(data)
  })

  // Get operation log for a DID
  router.get('/log/:did', async function (req, res) {
    const { did } = req.params
    const log = await ctx.db.opsForDid(did)
    if (log.length === 0) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    res.json({ log })
  })

  // Get the most recent operation in the log for a DID
  router.get('/last/:did', async function (req, res) {
    const { did } = req.params
    const log = await ctx.db.opsForDid(did)
    const curr = log.at(-1)
    if (!curr) {
      throw new ServerError(404, `DID not registered: ${did}`)
    }
    res.json(curr)
  })

  // Update or create a DID doc
  router.post('/:did', async function (req, res) {
    const { did } = req.params
    const op = req.body
    if (!check.is(op, plc.def.operation)) {
      throw new ServerError(400, `Not a valid operation: ${JSON.stringify(op)}`)
    }
    await ctx.db.validateAndAddOp(did, op)
    res.sendStatus(200)
  })

  return router
}

export default createRouter
