import { cidForCbor, check } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { MigrationResult } from 'kysely'
import { ServerError } from '../error'
import { OpLogExport, PlcDatabase } from './types'

type Contents = Record<string, plc.IndexedOperation[]>

export class MockDatabase implements PlcDatabase {
  contents: Contents = {}

  async close(): Promise<void> {}
  async healthCheck(): Promise<void> {}
  async migrateToLatestOrThrow(): Promise<MigrationResult[]> {
    return []
  }

  async validateAndAddOp(did: string, proposed: plc.Operation): Promise<void> {
    this.contents[did] ??= []
    const opsBefore = this.contents[did]
    // throws if invalid
    const { nullified } = await plc.assureValidNextOp(did, opsBefore, proposed)
    const cid = await cidForCbor(proposed)
    if (this.contents[did] !== opsBefore) {
      throw new ServerError(
        409,
        `Proposed prev does not match the most recent operation`,
      )
    }
    this.contents[did].push({
      did,
      operation: proposed,
      cid,
      nullified: false,
      createdAt: new Date(),
    })

    if (nullified.length > 0) {
      for (let i = 0; i < this.contents[did].length; i++) {
        const cid = this.contents[did][i].cid
        for (const toCheck of nullified) {
          if (toCheck.equals(cid)) {
            this.contents[did][i].nullified = true
          }
        }
      }
    }
  }

  async opsForDid(did: string): Promise<plc.OpOrTombstone[]> {
    const ops = await this._opsForDid(did)
    return ops.map((op) => {
      if (check.is(op.operation, plc.def.createOpV1)) {
        return plc.normalizeOp(op.operation)
      }
      return op.operation
    })
  }

  async _opsForDid(did: string): Promise<plc.IndexedOperation[]> {
    return this.contents[did] ?? []
  }

  async fullExport(): Promise<Record<string, OpLogExport>> {
    return {}
  }
}

export default MockDatabase
