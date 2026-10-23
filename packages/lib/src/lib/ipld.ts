import * as cborCodec from '@ipld/dag-cbor'
import * as Block from 'multiformats/block'
import type { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

export type { CID }

export const cborEncode = cborCodec.encode
export const cborDecode = cborCodec.decode

export async function cidForCbor(data: unknown): Promise<CID> {
  const block = await Block.encode({
    value: data,
    codec: cborCodec,
    hasher: sha256,
  })
  return block.cid
}
