// catch errors that get thrown in async route handlers
// this is a relatively non-invasive change to express
// they get handled in the error.handler middleware
// leave at top of file before importing Routes
import 'express-async-errors'
import './types'

import express from 'express'
import cors from 'cors'
import http from 'http'
import events from 'events'
import * as error from './error'
import createRouter from './routes'
import { loggerMiddleware } from './logger'
import AppContext from './context'
import { createHttpTerminator, HttpTerminator } from 'http-terminator'
import { PlcDatabase } from './db/types'
import { Socket } from 'net'
import Database from './db'
import { Sequencer, SequencerOptions } from './sequencer'

export * from './db'
export * from './context'
export * from './sequencer'

export class PlcServer {
  public ctx: AppContext
  public app: express.Application
  public server?: http.Server
  private terminator?: HttpTerminator

  constructor(opts: { ctx: AppContext; app: express.Application }) {
    this.ctx = opts.ctx
    this.app = opts.app
  }

  static create(opts: {
    db: PlcDatabase
    port?: number
    version?: string
    adminSecret?: string
    sequencer?: SequencerOptions
  }): PlcServer {
    const app = express()
    app.use(express.json({ limit: '100kb' }))
    app.use(cors())

    app.use(loggerMiddleware)

    // Initialize sequencer
    const sequencer = new Sequencer(opts.db as Database, opts.sequencer)

    const ctx = new AppContext({
      db: opts.db,
      sequencer,
      version: opts.version || '0.0.0',
      port: opts.port,
      adminSecret: opts.adminSecret,
    })

    app.use('/', createRouter(ctx))
    app.use(error.handler)

    // Must be the last middleware, used to clean up websocket requests to unhandled routes
    app.use((req, res, next): void => {
      if (req.ws && req.ws.handled === false) {
        req.ws.socket.destroy()
        res.sendStatus(404)
        return
      }
      next()
    })

    return new PlcServer({
      ctx,
      app,
    })
  }

  async start(): Promise<http.Server> {
    // Start sequencer
    await this.ctx.sequencer.start()

    const server = this.app.listen(this.ctx.port)

    // Capture required objects for express routes to handle websocket upgrades later,
    // per https://stackoverflow.com/a/69773286
    server.on('upgrade', (req, socket, head) => {
      // create a dummy response to pass the request into express
      const res = new http.ServerResponse(req)
      // assign socket and head to a new field in the request object
      // optional **handled** field lets us know if there a route processed the websocket request, else we terminate it later on
      req.ws = { socket, head, handled: false }
      this.app(req, res)
    })

    this.server = server
    this.terminator = createHttpTerminator({ server })
    await events.once(server, 'listening')
    return server
  }

  async destroy() {
    this.ctx.sequencer.destroy()
    await this.terminator?.terminate()
    await this.ctx.db.close()
  }
}

export default PlcServer
