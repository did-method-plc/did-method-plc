import * as plc from '@did-plc/lib'
import { Generated, Selectable } from 'kysely'

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
  exportOpsSeq(count: number, after: number): Promise<plc.ExportedOpWithSeq[]>
  removeInvalidOps(
    did: string,
    cid: string,
  ): Promise<plc.CompatibleOpOrTombstone[]>
}

export interface DidsTable {
  did: string
}

export interface OperationsTable {
  did: string
  operation: plc.CompatibleOpOrTombstone
  cid: string
  nullified: boolean
  createdAt: Generated<Date> // Note: we do not currently make use of the Generated feature, it could be removed in future
  seq: number | null
}

export type OperationsTableEntry = Selectable<OperationsTable>

export const PLC_SEQ_SEQUENCE = 'plc_seq_sequence'

export interface AdminLogsTable {
  id: Generated<number>
  type: string
  data: Record<string, string>
  createdAt: Generated<Date>
}

export interface DatabaseSchema {
  dids: DidsTable
  operations: OperationsTable
  admin_logs: AdminLogsTable
}
