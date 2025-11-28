import * as plc from '@did-plc/lib'

export type SeqEvt = {
  seq: number
  type: 'indexed_op'
  did: string
  operation: plc.CompatibleOpOrTombstone
  cid: string // this is redundant info, but allows consumers to double-check
  createdAt: string
  // Note: "nullified" field is NOT here (it is always false for new events, and keeping it synced would be hard)
}
