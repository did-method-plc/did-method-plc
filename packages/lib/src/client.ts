import { check, cidForCbor } from '@atproto/common'
import type { Keypair } from '@atproto/crypto'
import type { AxiosError, AxiosRequestConfig } from 'axios'
import axios from 'axios'
import {
  atprotoOp,
  createUpdateOp,
  didForCreateOp,
  tombstoneOp,
  updateAtprotoKeyOp,
  updateHandleOp,
  updatePdsOp,
  updateRotationKeysOp,
} from './operations.js'
import * as t from './types.js'

export type RequestOptions = {
  /**
   * Aborts the request(s) made by the call. An aborted call rejects with the
   * signal's `reason` (an `AbortError` DOMException unless another reason was
   * given to `abort()`), not a `PlcClientError`.
   */
  signal?: AbortSignal
}

export class Client {
  constructor(public url: string) {}

  private async request<T>(
    config: AxiosRequestConfig,
    opts?: RequestOptions,
  ): Promise<T> {
    const signal = opts?.signal
    try {
      const res = await axios.request({ ...config, signal })
      return res.data
    } catch (err) {
      if (signal?.aborted && axios.isCancel(err)) {
        throw signal.reason
      }
      if (!axios.isAxiosError(err)) {
        throw err
      }
      throw PlcClientError.fromAxiosError(err)
    }
  }

  private async makeGetReq<T>(url: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>({ method: 'GET', url }, opts)
  }

  async getDocument(
    did: string,
    opts?: RequestOptions,
  ): Promise<t.DidDocument> {
    return await this.makeGetReq(`${this.url}/${encodeURIComponent(did)}`, opts)
  }

  async getDocumentData(
    did: string,
    opts?: RequestOptions,
  ): Promise<t.DocumentData> {
    return await this.makeGetReq(
      `${this.url}/${encodeURIComponent(did)}/data`,
      opts,
    )
  }

  async getOperationLog(
    did: string,
    opts?: RequestOptions,
  ): Promise<t.CompatibleOpOrTombstone[]> {
    return await this.makeGetReq(
      `${this.url}/${encodeURIComponent(did)}/log`,
      opts,
    )
  }

  async getAuditableLog(
    did: string,
    opts?: RequestOptions,
  ): Promise<t.ExportedOp[]> {
    return await this.makeGetReq(
      `${this.url}/${encodeURIComponent(did)}/log/audit`,
      opts,
    )
  }

  postOpUrl(did: string): string {
    return `${this.url}/${encodeURIComponent(did)}`
  }

  async getLastOp(
    did: string,
    opts?: RequestOptions,
  ): Promise<t.CompatibleOpOrTombstone> {
    return await this.makeGetReq(
      `${this.url}/${encodeURIComponent(did)}/log/last`,
      opts,
    )
  }

  async sendOperation(
    did: string,
    op: t.OpOrTombstone,
    opts?: RequestOptions,
  ): Promise<void> {
    await this.request(
      { method: 'POST', url: this.postOpUrl(did), data: op },
      opts,
    )
  }

  async export(
    after?: number,
    count?: number,
    opts?: RequestOptions,
  ): Promise<t.ExportedOpWithSeq[]> {
    const url = new URL(`${this.url}/export`)
    url.searchParams.append('after', (after || 0).toString(10))
    if (count !== undefined) {
      url.searchParams.append('count', count.toString(10))
    }
    const data = await this.makeGetReq<string>(url.toString(), opts)
    const lines: string[] = data.split('\n')
    return lines.map((l) => JSON.parse(l))
  }

  async createDid(
    opts: {
      signingKey: string
      handle: string
      pds: string
      rotationKeys: string[]
      signer: Keypair
    },
    reqOpts?: RequestOptions,
  ): Promise<string> {
    const op = await atprotoOp({ ...opts, prev: null })
    const did = await didForCreateOp(op)
    await this.sendOperation(did, op, reqOpts)
    return did
  }

  async ensureLastOp(did: string, opts?: RequestOptions) {
    const lastOp = await this.getLastOp(did, opts)
    if (check.is(lastOp, t.def.tombstone)) {
      throw new Error('Cannot apply op to tombstone')
    }
    return lastOp
  }

  async updateData(
    did: string,
    signer: Keypair,
    fn: (lastOp: t.UnsignedOperation) => Omit<t.UnsignedOperation, 'prev'>,
    opts?: RequestOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await createUpdateOp(lastOp, signer, fn)
    await this.sendOperation(did, op, opts)
  }

  async updateAtprotoKey(
    did: string,
    signer: Keypair,
    atprotoKey: string,
    opts?: RequestOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updateAtprotoKeyOp(lastOp, signer, atprotoKey)
    await this.sendOperation(did, op, opts)
  }

  async updateHandle(
    did: string,
    signer: Keypair,
    handle: string,
    opts?: RequestOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updateHandleOp(lastOp, signer, handle)
    await this.sendOperation(did, op, opts)
  }

  async updatePds(
    did: string,
    signer: Keypair,
    endpoint: string,
    opts?: RequestOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updatePdsOp(lastOp, signer, endpoint)
    await this.sendOperation(did, op, opts)
  }

  async updateRotationKeys(
    did: string,
    signer: Keypair,
    keys: string[],
    opts?: RequestOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updateRotationKeysOp(lastOp, signer, keys)
    await this.sendOperation(did, op, opts)
  }

  async tombstone(did: string, signer: Keypair, opts?: RequestOptions) {
    const lastOp = await this.ensureLastOp(did, opts)
    const prev = await cidForCbor(lastOp)
    const op = await tombstoneOp(prev, signer)
    await this.sendOperation(did, op, opts)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async health(opts?: RequestOptions): Promise<any> {
    return await this.makeGetReq(`${this.url}/_health`, opts)
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
