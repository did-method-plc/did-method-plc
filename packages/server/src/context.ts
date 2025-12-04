import { WebSocketServer } from 'ws'
import { PlcDatabase } from './db'
import { Sequencer } from './sequencer'

export class AppContext {
  public wss: WebSocketServer

  constructor(
    private opts: {
      db: PlcDatabase
      sequencer: Sequencer
      version: string
      port?: number
      adminSecret?: string
    },
  ) {
    this.wss = new WebSocketServer({ noServer: true })
  }

  get db() {
    return this.opts.db
  }

  get sequencer() {
    return this.opts.sequencer
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
