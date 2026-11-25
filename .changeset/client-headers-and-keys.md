---
'@did-plc/lib': major
---

- Accept default `headers: HeadersInit` in the client constructor and per-call headers in request options. Per-call headers override defaults; operation POSTs set their required protocol headers.
- Expose error response headers as `Headers` instead of a plain record.
- Rename `Client.updateAtprotoKey` to `Client.updateAtprotoSigningKey` and `updateAtprotoKeyOp` to `updateAtprotoSigningKeyOp`. Add `Client.updateAtprotoKemKey` and `updateAtprotoKemKeyOp`.
- Send `If-Match: "<op.prev>"` with updates and tombstones, or `If-Match: *` when `ignorePrevMismatch: true` is set. Genesis operations omit the header. Stale updates now fail with `PlcPrevMismatchError` (HTTP 412); recovery operations must opt into `ignorePrevMismatch`. Concurrent transaction conflicts remain `PlcConflictError` (HTTP 409).
