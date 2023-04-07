import { check, cidForCbor } from '@atproto/common'
import { Keypair } from '@atproto/crypto'
import axios, { AxiosError } from 'axios'
import {
  atprotoOp,
  createUpdateOp,
  didForCreateOp,
  tombstoneOp,
  updateAtprotoKeyOp,
  updateHandleOp,
  updatePdsOp,
  updateRotationKeysOp,
} from './operations'
import * as t from './types'

export class Client {
  constructor(public url: string) {}

  private async makeGetReq(url: string) {
    try {
      const res = await axios.get(url)
      return res.data
    } catch (err) {
      if (!axios.isAxiosError(err)) {
        throw err
      }
      throw PlcClientError.fromAxiosError(err)
    }
  }

  async getDocument(did: string): Promise<t.DidDocument> {
    return await this.makeGetReq(`${this.url}/${encodeURIComponent(did)}`)
  }

  async getDocumentData(did: string): Promise<t.DocumentData> {
    return await this.makeGetReq(`${this.url}/${encodeURIComponent(did)}/data`)
  }

  async getOperationLog(did: string): Promise<t.CompatibleOpOrTombstone[]> {
    return await this.makeGetReq(`${this.url}/${encodeURIComponent(did)}/log`)
  }

  async getAuditableLog(did: string): Promise<t.ExportedOp[]> {
    return await this.makeGetReq(
      `${this.url}/${encodeURIComponent(did)}/log/audit`,
    )
  }

  postOpUrl(did: string): string {
    return `${this.url}/${encodeURIComponent(did)}`
  }

  async getLastOp(did: string): Promise<t.CompatibleOpOrTombstone> {
    return await this.makeGetReq(
      `${this.url}/${encodeURIComponent(did)}/log/last`,
    )
  }

  async sendOperation(did: string, op: t.OpOrTombstone) {
    try {
      await axios.post(this.postOpUrl(did), op)
    } catch (err) {
      if (!axios.isAxiosError(err)) {
        throw err
      }
      throw PlcClientError.fromAxiosError(err)
    }
  }

  async export(after?: string, count?: number): Promise<t.ExportedOp[]> {
    const url = new URL(`${this.url}/export`)
    if (after) {
      url.searchParams.append('after', after)
    }
    if (count !== undefined) {
      url.searchParams.append('count', count.toString(10))
    }
    const res = await axios.get(url.toString())
    const lines = res.data.split('\n')
    return lines.map((l) => JSON.parse(l))
  }

  async createDid(opts: {
    signingKey: string
    handle: string
    pds: string
    rotationKeys: string[]
    signer: Keypair
  }): Promise<string> {
    const op = await atprotoOp({ ...opts, prev: null })
    const did = await didForCreateOp(op)
    await this.sendOperation(did, op)
    return did
  }

  async ensureLastOp(did) {
    const lastOp = await this.getLastOp(did)
    if (check.is(lastOp, t.def.tombstone)) {
      throw new Error('Cannot apply op to tombstone')
    }
    return lastOp
  }

  async updateData(
    did: string,
    signer: Keypair,
    fn: (lastOp: t.UnsignedOperation) => Omit<t.UnsignedOperation, 'prev'>,
  ) {
    const lastOp = await this.ensureLastOp(did)
    const op = await createUpdateOp(lastOp, signer, fn)
    await this.sendOperation(did, op)
  }

  async updateAtprotoKey(did: string, signer: Keypair, atprotoKey: string) {
    const lastOp = await this.ensureLastOp(did)
    const op = await updateAtprotoKeyOp(lastOp, signer, atprotoKey)
    await this.sendOperation(did, op)
  }

  async updateHandle(did: string, signer: Keypair, handle: string) {
    const lastOp = await this.ensureLastOp(did)
    const op = await updateHandleOp(lastOp, signer, handle)
    await this.sendOperation(did, op)
  }

  async updatePds(did: string, signer: Keypair, endpoint: string) {
    const lastOp = await this.ensureLastOp(did)
    const op = await updatePdsOp(lastOp, signer, endpoint)
    await this.sendOperation(did, op)
  }

  async updateRotationKeys(did: string, signer: Keypair, keys: string[]) {
    const lastOp = await this.ensureLastOp(did)
    const op = await updateRotationKeysOp(lastOp, signer, keys)
    await this.sendOperation(did, op)
  }

  async tombstone(did: string, signer: Keypair) {
    const lastOp = await this.ensureLastOp(did)
    const prev = await cidForCbor(lastOp)
    const op = await tombstoneOp(prev, signer)
    await this.sendOperation(did, op)
  }

  async health() {
    return await this.makeGetReq(`${this.url}/_health`)
  }
}

export class PlcClientError extends Error {
  constructor(
    public status: number,
    public data: unknown,
    public message: string,
  ) {
    super(message)
  }

  static fromAxiosError(err: AxiosError) {
    return new PlcClientError(
      err.response?.status || 500,
      err.response?.data,
      err.message,
    )
  }
}

export default Client
