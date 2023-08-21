import { PlcDatabase } from './db'
import { Redis } from 'ioredis'

export class AppContext {
  constructor(
    private opts: {
      db: PlcDatabase
      version: string
      port?: number
      redis?: Redis
      debug: boolean
    },
  ) {}

  get db() {
    return this.opts.db
  }

  get version() {
    return this.opts.version
  }

  get port() {
    return this.opts.port
  }

  get redis() {
    return this.opts.redis
  }

  get debug() {
    return this.opts.debug
  }
}

export default AppContext
