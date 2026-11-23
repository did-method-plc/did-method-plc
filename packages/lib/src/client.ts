import { check, cidForCbor } from '@atproto/common'
import type { Keypair } from '@atproto/crypto'
import type { AtprotoOpOpts } from './operations.js'
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

export type ClientOptions = {
  /**
   * The `fetch` implementation used for requests. Defaults to the global
   * `fetch`, resolved at call time. Rejections from it (network failures,
   * custom errors) propagate to the caller unchanged.
   */
  fetch?: typeof globalThis.fetch
}

export class Client {
  private customFetch: typeof globalThis.fetch | undefined

  constructor(
    public url: string,
    opts?: ClientOptions,
  ) {
    this.customFetch = opts?.fetch
  }

  /**
   * Performs the request and reads a 2xx response with `read`. Failed requests
   * reject with the fetch error as-is (not a `PlcClientError`); non-2xx
   * responses reject with a `PlcClientError`. If the signal aborts at any
   * point, including while a body is being read, the call rejects with the
   * signal's reason.
   */
  private async request<T>(
    url: string,
    init: RequestInit,
    read: (res: Response) => Promise<T>,
    opts?: RequestOptions,
  ): Promise<T> {
    const signal = opts?.signal
    // a local variable, so the default fetch is called unbound
    const fetchFn = this.customFetch ?? globalThis.fetch
    try {
      const res = await fetchFn(url, { ...init, signal })
      if (!res.ok) throw await errorFromResponse(res)
      return await read(res)
    } catch (err) {
      if (signal?.aborted && !(err instanceof PlcClientError)) {
        throw signal.reason
      }
      throw err
    }
  }

  private async makeGetReq<T>(url: string, opts?: RequestOptions): Promise<T> {
    return await this.request(
      url,
      { method: 'GET' },
      async (res) => (await res.json()) as T,
      opts,
    )
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
      this.postOpUrl(did),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(op),
      },
      // release the connection without buffering an unused body
      async (res) => {
        await res.body?.cancel()
      },
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
    const data = await this.request(
      url.toString(),
      { method: 'GET' },
      (res) => res.text(),
      opts,
    )
    const lines = data.split('\n').filter((l) => l.length > 0)
    return lines.map((l) => JSON.parse(l))
  }

  async createDid(
    opts: AtprotoOpOpts & { signer: Keypair },
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
      throw new TombstonedDidError(did)
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

/**
 * A non-2xx response from the PLC directory. `status` is the HTTP status of
 * the response. Network failures are not wrapped: they reject with the error
 * from `fetch`.
 */
export class PlcClientError extends Error {
  override name: string = 'PlcClientError'
  /** Response headers, lowercased. */
  public headers: Record<string, string>

  constructor(
    public status: number,
    public data: unknown,
    public message: string,
    opts?: { headers?: Record<string, string>; cause?: unknown },
  ) {
    super(message, { cause: opts?.cause })
    this.headers = opts?.headers ?? {}
  }
}

/**
 * The directory rejected the operation with 409: another operation for the
 * DID was committed concurrently, so the op's `prev` is no longer the latest.
 * Re-reading the last op and re-signing is the usual remedy.
 */
export class PlcConflictError extends PlcClientError {
  override name: string = 'PlcConflictError'

  constructor(
    data: unknown,
    message: string,
    opts?: { headers?: Record<string, string>; cause?: unknown },
  ) {
    super(409, data, message, opts)
  }
}

/** The DID's latest operation is a tombstone, so no op can follow it. */
export class TombstonedDidError extends Error {
  override name: string = 'TombstonedDidError'

  constructor(public did: string) {
    super(`Cannot apply op to tombstone: ${did}`)
  }
}

const errorFromResponse = async (res: Response): Promise<PlcClientError> => {
  const headers: Record<string, string> = {}
  res.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value
  })
  const text = await res.text()
  let data: unknown = text
  if (headers['content-type']?.includes('json')) {
    try {
      data = JSON.parse(text)
    } catch {
      // keep the raw text
    }
  }
  const plcMessage =
    data && typeof data === 'object' && 'message' in data
      ? data.message
      : undefined
  const message =
    typeof plcMessage === 'string' && plcMessage
      ? plcMessage
      : `Request failed with status code ${res.status}`
  const opts = { headers }
  if (res.status === 409) return new PlcConflictError(data, message, opts)
  return new PlcClientError(res.status, data, message, opts)
}

export default Client
