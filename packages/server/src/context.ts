import { PlcDatabase } from './db'

export class AppContext {
  constructor(
    private opts: {
      db: PlcDatabase
      version: string
      port?: number
      adminSecret?: string
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

  get adminSecret() {
    return this.opts.adminSecret
  }
}

export default AppContext
