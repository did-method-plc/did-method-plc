import './types'

import * as compression from 'compression'
import * as cors from 'cors'
import * as express from 'express'
import { createHttpTerminator, HttpTerminator } from 'http-terminator'
import * as events from 'node:events'
import http from 'node:http'
import AppContext from './context'
import { PlcDatabase } from './db'
import { handler as errorHandler } from './error'
import { loggerMiddleware } from './logger'
import createRouter from './routes'
import { Sequencer, SequencerOptions } from './sequencer'

export * from './context'
export * from './db'
export * from './logger'
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
    app.use(compression())

    app.use(loggerMiddleware)

    // Initialize sequencer
    const sequencer = new Sequencer(opts.db, opts.sequencer)

    const ctx = new AppContext({
      db: opts.db,
      sequencer,
      version: opts.version || '0.0.0',
      port: opts.port,
      adminSecret: opts.adminSecret,
    })

    app.use('/', createRouter(ctx))
    app.use(errorHandler)

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
