import { PlcDatabase } from './db'
import { RedisClientType } from 'redis'

export class AppContext {
  constructor(
    private opts: {
      db: PlcDatabase
      version: string
      port?: number
      redis?: RedisClientType
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
}

export default AppContext
