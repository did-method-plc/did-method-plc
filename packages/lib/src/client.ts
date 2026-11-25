import { check, cidForCbor } from '@atproto/common'
import type { Keypair } from '@atproto/crypto'
import type { AtprotoOpOpts } from './operations.js'
import {
  atprotoOp,
  createUpdateOp,
  didForCreateOp,
  tombstoneOp,
  updateAtprotoKemKeyOp,
  updateAtprotoSigningKeyOp,
  updateHandleOp,
  updatePdsOp,
  updateRotationKeysOp,
} from './operations.js'
import * as t from './types.js'

export type RequestOptions = {
  /** Request headers, overriding the client's defaults. */
  headers?: HeadersInit
  /**
   * Aborts the request(s) made by the call. An aborted call rejects with the
   * signal's `reason` (an `AbortError` DOMException unless another reason was
   * given to `abort()`), not a `PlcClientError`.
   */
  signal?: AbortSignal
}

export type MutationOptions = RequestOptions & {
  /** Match any existing head instead of requiring the operation's `prev`. */
  ignorePrevMismatch?: boolean
}

export type ClientOptions = {
  /** Default headers sent with every request. */
  headers?: HeadersInit
  /**
   * The `fetch` implementation used for requests. Defaults to the global
   * `fetch`, resolved at call time. Rejections from it (network failures,
   * custom errors) propagate to the caller unchanged.
   */
  fetch?: typeof globalThis.fetch
}

export class Client {
  private customFetch: typeof globalThis.fetch | undefined
  private headers: Headers

  constructor(
    public url: string,
    opts?: ClientOptions,
  ) {
    this.customFetch = opts?.fetch
    this.headers = new Headers(opts?.headers)
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
    const headers = new Headers(this.headers)
    new Headers(opts?.headers).forEach((value, name) =>
      headers.set(name, value),
    )
    // Protocol headers take precedence over caller-supplied headers.
    new Headers(init.headers).forEach((value, name) => headers.set(name, value))
    // a local variable, so the default fetch is called unbound
    const fetchFn = this.customFetch ?? globalThis.fetch
    try {
      const res = await fetchFn(url, { ...init, headers, signal })
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
    opts?: MutationOptions,
  ): Promise<void> {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (op.prev !== null) {
      headers.set('if-match', opts?.ignorePrevMismatch ? '*' : `"${op.prev}"`)
    }
    await this.request(
      this.postOpUrl(did),
      {
        method: 'POST',
        headers,
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
    opts?: MutationOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await createUpdateOp(lastOp, signer, fn)
    await this.sendOperation(did, op, opts)
  }

  async updateAtprotoSigningKey(
    did: string,
    signer: Keypair,
    signingKey: string,
    opts?: MutationOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updateAtprotoSigningKeyOp(lastOp, signer, signingKey)
    await this.sendOperation(did, op, opts)
  }

  async updateAtprotoKemKey(
    did: string,
    signer: Keypair,
    kemKey: string,
    opts?: MutationOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updateAtprotoKemKeyOp(lastOp, signer, kemKey)
    await this.sendOperation(did, op, opts)
  }

  async updateHandle(
    did: string,
    signer: Keypair,
    handle: string,
    opts?: MutationOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updateHandleOp(lastOp, signer, handle)
    await this.sendOperation(did, op, opts)
  }

  async updatePds(
    did: string,
    signer: Keypair,
    endpoint: string,
    opts?: MutationOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updatePdsOp(lastOp, signer, endpoint)
    await this.sendOperation(did, op, opts)
  }

  async updateRotationKeys(
    did: string,
    signer: Keypair,
    keys: string[],
    opts?: MutationOptions,
  ) {
    const lastOp = await this.ensureLastOp(did, opts)
    const op = await updateRotationKeysOp(lastOp, signer, keys)
    await this.sendOperation(did, op, opts)
  }

  async tombstone(did: string, signer: Keypair, opts?: MutationOptions) {
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
  /** Response headers. */
  public headers: Headers

  constructor(
    public status: number,
    public data: unknown,
    public message: string,
    opts?: { headers?: Headers; cause?: unknown },
  ) {
    super(message, { cause: opts?.cause })
    this.headers = opts?.headers ?? new Headers()
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
    opts?: { headers?: Headers; cause?: unknown },
  ) {
    super(409, data, message, opts)
  }
}

/**
 * The directory rejected the request with 412 because `If-Match` did not
 * match the DID's latest operation, or the DID does not exist.
 */
export class PlcPrevMismatchError extends PlcClientError {
  override name: string = 'PlcPrevMismatchError'

  constructor(
    data: unknown,
    message: string,
    opts?: { headers?: Headers; cause?: unknown },
  ) {
    super(412, data, message, opts)
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
  const headers = res.headers
  const text = await res.text()
  let data: unknown = text
  if (headers.get('content-type')?.includes('json')) {
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
  if (res.status === 412) return new PlcPrevMismatchError(data, message, opts)
  return new PlcClientError(res.status, data, message, opts)
}

export default Client
