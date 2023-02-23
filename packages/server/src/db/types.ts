import * as plc from '@did-plc/lib'
import { MigrationResult } from 'kysely'

export interface PlcDatabase {
  close(): Promise<void>
  migrateToLatestOrThrow(): Promise<MigrationResult[]>
  healthCheck(): Promise<void>
  validateAndAddOp(did: string, proposed: plc.Operation): Promise<void>
  opsForDid(did: string): Promise<plc.OpOrTombstone[]>
  _opsForDid(did: string): Promise<plc.IndexedOperation[]>
  fullExport(): Promise<Record<string, OpLogExport>>
}

export type OpLogExport = OpExport[]

export type OpExport = {
  op: Record<string, unknown>
  nullified: boolean
  createdAt: string
}
