---
'@did-plc/lib': major
---

The client is more robust and reports failures in more detail.

- Every client call accepts `{ signal }` and rejects with the signal's reason when aborted.
- `export()` correctly parses single-operation and empty pages.
- `atproto` operations accept a KEM key.
- `PlcClientError` carries the response `headers` and the directory's own error message.
- A 409 response is reported as `PlcConflictError`, and operating on a tombstoned DID as `TombstonedDidError`.
- A failure with no response (refused, reset, DNS) propagates unchanged rather than being reported as an HTTP status.
