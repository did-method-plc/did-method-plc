import { cidForCbor } from '@atproto/common'
import * as plc from '@did-plc/lib'
import { ServerError } from '../error'
import { OperationsTableEntry, PlcDatabase } from './types'

type Contents = Record<string, plc.IndexedOperation[]>

type LoggedOp = plc.IndexedOperation & { seq: number }

export class MockDatabase implements PlcDatabase {
  contents: Contents = {}
  private opLog: LoggedOp[] = []
  private seq = 0

  static create(): MockDatabase {
    return new MockDatabase()
  }

  async close(): Promise<void> {}
  async healthCheck(): Promise<void> {}

  async validateAndAddOp(
    did: string,
    proposed: plc.OpOrTombstone,
    proposedDate: Date,
  ): Promise<void> {
    this.contents[did] ??= []
    const opsBefore = this.contents[did]
    // throws if invalid
    const { nullified } = await plc.assureValidNextOp(
      did,
      opsBefore,
      proposed,
      proposedDate,
    )
    const cid = await cidForCbor(proposed)
    if (this.contents[did] !== opsBefore) {
      throw new ServerError(
        409,
        `Proposed prev does not match the most recent operation`,
      )
    }
    const indexedOp: LoggedOp = {
      did,
      operation: proposed,
      cid,
      nullified: false,
      createdAt: proposedDate,
      seq: ++this.seq,
    }
    this.contents[did].push(indexedOp)
    this.opLog.push(indexedOp)

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
    return ops.map((op) => op.operation)
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

  async exportOpsSeq(
    _count: number,
    _after: number,
  ): Promise<plc.ExportedOpWithSeq[]> {
    return []
  }

  async removeInvalidOps(
    _did: string,
    _cid: string,
  ): Promise<plc.CompatibleOpOrTombstone[]> {
    throw new Error('not implemented in mock')
  }

  async curr(): Promise<OperationsTableEntry | null> {
    const last = this.opLog.at(-1)
    if (!last) return null
    return toTableEntry(last)
  }

  async next(cursor: number): Promise<OperationsTableEntry | null> {
    const found = this.opLog.find((op) => op.seq > cursor)
    if (!found) return null
    return toTableEntry(found)
  }

  async requestSeqRange(opts: {
    earliestSeq?: number
    latestSeq?: number
    limit?: number
  }): Promise<plc.ExportedOpWithSeq[]> {
    const { earliestSeq, latestSeq, limit } = opts
    let ops = this.opLog.filter(
      (op) =>
        (earliestSeq === undefined || op.seq > earliestSeq) &&
        (latestSeq === undefined || op.seq <= latestSeq),
    )
    if (limit !== undefined) {
      ops = ops.slice(0, limit)
    }
    return ops.map(
      (op): plc.ExportedOpWithSeq => ({
        type: 'sequenced_op',
        did: op.did,
        operation: op.operation,
        cid: op.cid.toString(),
        createdAt: op.createdAt.toISOString(),
        seq: op.seq,
      }),
    )
  }
}

export default MockDatabase

function toTableEntry(op: LoggedOp): OperationsTableEntry {
  return {
    did: op.did,
    operation: structuredClone(op.operation),
    cid: op.cid.toString(),
    nullified: op.nullified,
    createdAt: new Date(op.createdAt),
    seq: op.seq,
  }
}
