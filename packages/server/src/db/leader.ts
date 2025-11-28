import { sql } from 'kysely'
import Database from './index'

export class Leader {
  session: LeaderSession | null = null
  isLockingDb = false

  constructor(public id: number, public db: Database) {}

  async run<T>(
    task: (ctx: { signal: AbortSignal }) => Promise<T>,
  ): Promise<{ ran: boolean; result?: T }> {
    this.session = new LeaderSession()
    const { signal } = this.session

    try {
      await this.lock()
      if (signal.aborted) {
        return { ran: false }
      }
      const result = await task({ signal })
      return { ran: true, result }
    } catch (err) {
      if (signal.aborted) {
        return { ran: false }
      }
      throw err
    } finally {
      await this.unlock()
      this.session = null
    }
  }

  async lock(): Promise<void> {
    if (this.isLockingDb) return
    this.isLockingDb = true
    try {
      await sql`SELECT pg_advisory_lock(${sql.literal(this.id)})`.execute(
        this.db.db,
      )
    } finally {
      this.isLockingDb = false
    }
  }

  async unlock(): Promise<void> {
    await sql`SELECT pg_advisory_unlock(${sql.literal(this.id)})`.execute(
      this.db.db,
    )
  }

  destroy(err?: Error): void {
    this.session?.abort(err ?? new DisconnectError())
  }
}

export class LeaderSession {
  aborted = false
  private _controller = new AbortController()

  get signal(): AbortSignal {
    return this._controller.signal
  }

  abort(err?: Error): void {
    if (this.aborted) return
    this.aborted = true
    this._controller.abort(err)
  }
}

export class DisconnectError extends Error {
  constructor() {
    super('Leader session disconnected')
    this.name = 'DisconnectError'
  }
}
