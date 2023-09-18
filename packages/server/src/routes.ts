import express from 'express'
import { cborEncode, check } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from './error'
import { AppContext } from './context'
import { parseDidKey } from '@atproto/crypto'

export const createRouter = (ctx: AppContext): express.Router => {
  const router = express.Router()

  router.get('/', async function (req, res) {
    // HTTP temporary redirect to project git repo
    res.redirect(302, 'https://github.com/bluesky-social/did-method-plc')
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
    const parsedCount = req.query.count ? parseInt(req.query.count, 10) : 1000
    if (isNaN(parsedCount) || parsedCount < 1) {
      throw new ServerError(400, 'Invalid count parameter')
    }
    const count = Math.min(parsedCount, 1000)
    const after = req.query.after ? new Date(req.query.after) : undefined
    const ops = await ctx.db.exportOps(count, after)
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
    await ctx.db.validateAndAddOp(did, op)
    res.sendStatus(200)
  })

  return router
}

export function assertValidIncomingOp(
  op: unknown,
): asserts op is plc.OpOrTombstone {
  const byteLength = cborEncode(op).byteLength
  if (byteLength > 4000) {
    throw new ServerError(400, 'Operation too large')
  }
  if (!check.is(op, plc.def.opOrTombstone)) {
    throw new ServerError(400, `Not a valid operation: ${JSON.stringify(op)}`)
  }
  if (op.type === 'plc_tombstone') {
    return
  }
  if (op.alsoKnownAs.length > 10) {
    throw new ServerError(400, 'To many alsoKnownAs items (max 10)')
  }
  for (const aka of op.alsoKnownAs) {
    if (aka.length > 256) {
      throw new ServerError(400, `alsoKnownAs field too long (max 256): ${aka}`)
    }
  }
  if (op.rotationKeys.length > 5) {
    throw new ServerError(400, 'To many rotationKey items (max 5)')
  }
  for (const key of op.rotationKeys) {
    try {
      parseDidKey(key)
    } catch (err) {
      throw new ServerError(400, `Invalid rotationKey: ${key}`)
    }
  }
  const serviceEntries = Object.entries(op.services)
  if (serviceEntries.length > 10) {
    throw new ServerError(400, 'To many service entries (max 10)')
  }
  for (const [id, service] of serviceEntries) {
    if (id.length > 32) {
      throw new ServerError(400, `Service id too long (max 32): ${id}`)
    }
    if (service.type.length > 256) {
      throw new ServerError(400, 'Service type too long (max 256)')
    }
    if (service.endpoint.length > 512) {
      throw new ServerError(400, 'Service endpoint too long (max 512)')
    }
  }
  const verifyMethods = Object.entries(op.verificationMethods)
  for (const [id, key] of verifyMethods) {
    if (id.length > 32) {
      throw new ServerError(
        400,
        `Verification Method id too long (max 32): ${id}`,
      )
    }
    try {
      parseDidKey(key)
    } catch (err) {
      throw new ServerError(400, `Invalid verificationMethod key: ${key}`)
    }
  }
}

export default createRouter
