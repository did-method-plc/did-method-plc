import * as plc from '@did-plc/lib'
import { Generated } from 'kysely'

export interface PlcDatabase {
  close(): Promise<void>
  healthCheck(): Promise<void>
  validateAndAddOp(
    did: string,
    proposed: plc.CompatibleOpOrTombstone,
    proposedDate: Date,
  ): Promise<void>
  opsForDid(did: string): Promise<plc.CompatibleOpOrTombstone[]>
  indexedOpsForDid(
    did: string,
    includeNull?: boolean,
  ): Promise<plc.IndexedOperation[]>
  lastOpForDid(did: string): Promise<plc.CompatibleOpOrTombstone | null>
  exportOps(count: number, after?: Date): Promise<plc.ExportedOp[]>
}

export interface DidsTable {
  did: string
}

export interface OperationsTable {
  did: string
  operation: plc.CompatibleOpOrTombstone
  cid: string
  nullified: boolean
  createdAt: Date
}

export interface DatabaseSchema {
  dids: DidsTable
  operations: OperationsTable
}
