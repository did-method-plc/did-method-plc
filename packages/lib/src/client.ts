import { cidForCbor } from '@atproto/common'
import { Keypair } from '@atproto/crypto'
import axios from 'axios'
import { didForCreateOp, signOperation } from './operations'
import * as t from './types'

export class Client {
  constructor(public url: string) {}

  async getDocument(did: string): Promise<t.DidDocument> {
    const res = await axios.get(`${this.url}/${encodeURIComponent(did)}`)
    return res.data
  }

  async getDocumentData(did: string): Promise<t.DocumentData> {
    const res = await axios.get(`${this.url}/data/${encodeURIComponent(did)}`)
    return res.data
  }

  async getOperationLog(did: string): Promise<t.Operation[]> {
    const res = await axios.get(`${this.url}/log/${encodeURIComponent(did)}`)
    return res.data.log
  }

  postOpUrl(did: string): string {
    return `${this.url}/${encodeURIComponent(did)}`
  }

  async getLastOp(did: string): Promise<t.Operation> {
    const res = await axios.get(`${this.url}/last/${encodeURIComponent(did)}`)
    return res.data
  }

  async applyPartialOp(
    did: string,
    delta: Partial<t.UnsignedOperation>,
    key: Keypair,
  ) {
    const lastOp = await this.getLastOp(did)
    const prev = await cidForCbor(lastOp)
    const { signingKey, rotationKeys, handles, services } = lastOp
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

  async sendOperation(did: string, op: t.Operation) {
    await axios.post(this.postOpUrl(did), op)
  }

  async health() {
    return await axios.get(`${this.url}/_health`)
  }
}

export default Client
