import { check, cidForCbor } from '@atproto/common'
import { Keypair } from '@atproto/crypto'
import axios from 'axios'
import { didForCreateOp, normalizeOp, signOperation } from './operations'
import * as t from './types'

export class Client {
  constructor(public url: string) {}

  async getDocument(did: string): Promise<t.DidDocument> {
    const res = await axios.get(`${this.url}/${encodeURIComponent(did)}`)
    return res.data
  }

  async getDocumentData(did: string): Promise<t.DocumentData> {
    const res = await axios.get(`${this.url}/${encodeURIComponent(did)}/data`)
    return res.data
  }

  async getOperationLog(
    did: string,
    includeNull = false,
  ): Promise<t.CompatibleOpOrTombstone[]> {
    let url = `${this.url}/${encodeURIComponent(did)}/log`
    if (includeNull) {
      url += '?includeNull=true'
    }
    const res = await axios.get(url)
    return res.data.log
  }

  postOpUrl(did: string): string {
    return `${this.url}/${encodeURIComponent(did)}`
  }

  async getLastOp(did: string): Promise<t.CompatibleOpOrTombstone> {
    const res = await axios.get(`${this.url}/${encodeURIComponent(did)}/last`)
    return res.data
  }

  async applyPartialOp(
    did: string,
    delta: Partial<t.UnsignedOperation>,
    key: Keypair,
  ) {
    const lastOp = await this.getLastOp(did)
    if (check.is(lastOp, t.def.tombstone)) {
      throw new Error('Cannot apply op to tombstone')
    }
    const prev = await cidForCbor(lastOp)
    const { signingKey, rotationKeys, handles, services } = normalizeOp(lastOp)
    const op = await signOperation(
      {
        signingKey,
        rotationKeys,
        handles,
        services,
        prev: prev.toString(),
        ...delta,
      },
      key,
    )
    await this.sendOperation(did, op)
  }

  async create(
    op: Omit<t.UnsignedOperation, 'prev'>,
    key: Keypair,
  ): Promise<string> {
    const createOp = await signOperation(
      {
        ...op,
        prev: null,
      },
      key,
    )
    const did = await didForCreateOp(createOp)
    await this.sendOperation(did, createOp)
    return did
  }

  async sendOperation(did: string, op: t.OpOrTombstone) {
    await axios.post(this.postOpUrl(did), op)
  }

  async export(): Promise<t.ExportedOp[]> {
    const res = await axios.get(`${this.url}/export`)
    const lines = res.data.split('\n')
    return lines.map((l) => JSON.parse(l))
  }

  async health() {
    return await axios.get(`${this.url}/_health`)
  }
}

export default Client
