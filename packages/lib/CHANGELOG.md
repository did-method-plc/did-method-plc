# @did-plc/lib

## 1.0.0

### Major Changes

- 984aff1: `@did-plc/lib` is now an ESM-only package, with no CommonJS `require` export, and requires Node 22.18 or newer. It now uses multiformats 13 and current `@atproto/common` and `@atproto/crypto`, so CIDs and keys are those packages' types.
  
  Also included in this release, since the last published version (0.0.4):
  
  - `client.export(after, count)` now takes a numeric `after` sequence number instead of an ISO date string, and returns `ExportedOpWithSeq[]`.
  - `assureValidOp` is no longer exported, and `assureValidNextOp` no longer checks that keys are supported or that there are 1 to 5 rotation keys. Callers that relied on those checks should validate keys themselves.
  - Operations, tombstones, and service objects are parsed strictly, so objects with unknown fields are rejected.
  - Signatures with `=` base64 padding are rejected as invalid.
