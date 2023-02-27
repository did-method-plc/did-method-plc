import { cidForCbor, check } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from '../error'
import { PlcDatabase } from './types'

type Contents = Record<string, plc.IndexedOperation[]>

export class MockDatabase implements PlcDatabase {
  contents: Contents = {}

  async close(): Promise<void> {}
  async healthCheck(): Promise<void> {}

  async validateAndAddOp(
    did: string,
    proposed: plc.OpOrTombstone,
  ): Promise<void> {
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

  async opsForDid(did: string): Promise<plc.CompatibleOpOrTombstone[]> {
    const ops = await this.indexedOpsForDid(did)
    return ops.map((op) => {
      if (check.is(op.operation, plc.def.createOpV1)) {
        return plc.normalizeOp(op.operation)
      }
      return op.operation
    })
  }

  async indexedOpsForDid(
    did: string,
    includeNull = false,
  ): Promise<plc.IndexedOperation[]> {
    const ops = this.contents[did] ?? []
    if (includeNull) {
      return ops
    }
    return ops.filter((op) => op.nullified === false)
  }

  async lastOpForDid(did: string): Promise<plc.CompatibleOpOrTombstone | null> {
    const op = this.contents[did]?.at(-1)

    if (!op) return null
    return op.operation
  }

  // disabled in mocks
  async exportOps(_count: number, _after?: Date): Promise<plc.ExportedOp[]> {
    return []
  }
}

export default MockDatabase
