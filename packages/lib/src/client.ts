import { check, cidForCbor } from '@atproto/common'
import { Keypair } from '@atproto/crypto'
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
    const res = await fetch(url)
    if (!res.ok) {
      const data = await res.json().catch(() => undefined)
      throw new PlcClientError(res.status, data, `HTTP error ${res.status}`)
     }
     return res.json()
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
    const res = await fetch(this.postOpUrl(did), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => undefined)
      throw new PlcClientError(res.status, data, `HTTP error ${res.status}`)
  }

  async export(after?: number, count?: number): Promise<t.ExportedOpWithSeq[]> {
    const url = new URL(`${this.url}/export`)
    url.searchParams.append('after', (after || 0).toString(10))
    if (count !== undefined) {
      url.searchParams.append('count', count.toString(10))
    }
    const res = await fetch(url.toString())
    if (!res.ok) {
      const data = await res.text().catch(() => undefined)
      throw new PlcClientError(res.status, data, `HTTP error ${res.status}`)
    }
    const text = await res.text()
    const lines = text.split('\n').filter(Boolean)
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
}

export default Client
