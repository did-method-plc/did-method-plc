// catch errors that get thrown in async route handlers
// this is a relatively non-invasive change to express
// they get handled in the error.handler middleware
// leave at top of file before importing Routes
import 'express-async-errors'

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
import { Redis } from 'ioredis'

export * from './db'
export * from './context'

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
    redis?: Redis
    port?: number
    version?: string
    debug?: boolean
    rateLimitBypassToken?: string
  }): PlcServer {
    const app = express()
    app.use(express.json({ limit: '100kb' }))
    app.use(cors())

    app.use(loggerMiddleware)

    const ctx = new AppContext({
      db: opts.db,
      version: opts.version || '0.0.0',
      port: opts.port,
      redis: opts.redis,
      debug: !!opts.debug,
      rateLimitBypassToken: opts.rateLimitBypassToken,
    })

    app.use('/', createRouter(ctx))
    app.use(error.handler)

    return new PlcServer({
      ctx,
      app,
    })
  }

  async start(): Promise<http.Server> {
    const server = this.app.listen(this.ctx.port)
    this.server = server
    this.terminator = createHttpTerminator({ server })
    await events.once(server, 'listening')
    return server
  }

  async destroy() {
    await this.terminator?.terminate()
    await this.ctx.db.close()
    await this.ctx.redis?.quit()
  }
}

export default PlcServer
