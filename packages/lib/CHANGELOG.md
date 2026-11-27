# @did-plc/lib

## 1.0.0

### Major Changes

- 46bd9ce: The client uses the platform `fetch` instead of axios.
  
  - `new Client(url, { fetch })` accepts a custom `fetch` implementation.
  - Network failures reject with the error from `fetch` (e.g. a `TypeError`) instead of an axios error.
  - `PlcClientError.fromAxiosError` is removed, and `PlcClientError` no longer has an axios `cause`.
- 99b3a82: - Accept default `headers: HeadersInit` in the client constructor and per-call headers in request options. Per-call headers override defaults; operation POSTs set their required protocol headers.
  - Expose error response headers as `Headers` instead of a plain record.
  - Rename `Client.updateAtprotoKey` to `Client.updateAtprotoSigningKey` and `updateAtprotoKeyOp` to `updateAtprotoSigningKeyOp`. Add `Client.updateAtprotoKemKey` and `updateAtprotoKemKeyOp`.
  - Send `If-Match: "<op.prev>"` with updates and tombstones, or `If-Match: *` when `ignorePrevMismatch: true` is set. Genesis operations omit the header. Stale updates now fail with `PlcPrevMismatchError` (HTTP 412); recovery operations must opt into `ignorePrevMismatch`. Concurrent transaction conflicts remain `PlcConflictError` (HTTP 409).
- 0a233bb: The client is more robust and reports failures in more detail.
  
  - Every client call accepts `{ signal }` and rejects with the signal's reason when aborted.
  - `export()` correctly parses single-operation and empty pages.
  - `atproto` operations accept a KEM key.
  - `PlcClientError` carries the response `headers` and the directory's own error message.
  - A 409 response is reported as `PlcConflictError`, and operating on a tombstoned DID as `TombstonedDidError`.
  - A failure with no response (refused, reset, DNS) propagates unchanged rather than being reported as an HTTP status.
- 984aff1: `@did-plc/lib` is now an ESM-only package, with no CommonJS `require` export, and requires Node 22.18 or newer. It now uses multiformats 13 and current `@atproto/common` and `@atproto/crypto`, so CIDs and keys are those packages' types.
  
  Also included in this release, since the last published version (0.0.4):
  
  - `client.export(after, count)` now takes a numeric `after` sequence number instead of an ISO date string, and returns `ExportedOpWithSeq[]`.
  - `assureValidOp` is no longer exported, and `assureValidNextOp` no longer checks that keys are supported or that there are 1 to 5 rotation keys. Callers that relied on those checks should validate keys themselves.
  - Operations, tombstones, and service objects are parsed strictly, so objects with unknown fields are rejected.
  - Signatures with `=` base64 padding are rejected as invalid.
