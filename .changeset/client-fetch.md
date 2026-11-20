---
'@did-plc/lib': major
---

The client uses the platform `fetch` instead of axios.

- `new Client(url, { fetch })` accepts a custom `fetch` implementation.
- Network failures reject with the error from `fetch` (e.g. a `TypeError`) instead of an axios error.
- `PlcClientError.fromAxiosError` is removed, and `PlcClientError` no longer has an axios `cause`.
