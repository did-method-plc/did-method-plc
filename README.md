# DID PLC Method (did:plc)

DID PLC is a self-authenticating [DID](https://www.w3.org/TR/did-core/) which is strongly-consistent, recoverable, and allows for key rotation. PLC stands for "Public Ledger of Credentials".

An example DID is: `did:plc:ewvi7nxzyoun6zhxrhs64oiz`

Control over a `did:plc` identity rests in a set of reconfigurable rotation keys pairs. These keys can sign update operations to mutate the identity (including key rotations), with each operation referencing a prior version of the identity state by hash. Each identity starts from an initial genesis operation, and the hash of this initial object is what defines the DID itself (that is, the DID URI identifier string). A central directory server collects and validates operations, and maintains a transparent log of operations for each DID.

This git repository contains a TypeScript reference implementation of the method (`@did-plc/lib`) and a directory server `@did-plc/server`, both in the `package/` directory. The separate [go-didplc](https://github.com/did-method-plc/go-didplc) repository contains a Go implementation.

## Motivation

The DID PLC system was originally developed in 2022 by [Bluesky Social PBC](https://bsky.social/) to support [AT Protocol](https://atproto.com) (atproto). They wanted a strongly consistent, highly available, recoverable, and cryptographically secure method with fast and cheap propagation of updates. Since then over 40 million atproto account identifiers have been registered.

In 2026 the [PLC Organization](https://plcred.org) was founded to be a neutral steward for the DID PLC system. The system may evolve to add functionality or improve security, but will do so in a backwards-compatible manner so that existing DIDs will continue to resolve.

## How it works

See the [specification](website/spec/v0.1/did-plc.md#how-it-works).

## License

This project is dual-licensed under MIT and Apache 2.0 terms:

- Apache License, Version 2.0, ([LICENSE-APACHE](https://github.com/ipfs/kubo/blob/master/LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](https://github.com/ipfs/kubo/blob/master/LICENSE-MIT) or http://opensource.org/licenses/MIT)

Downstream projects and users may chose either license, or both, at their discretion. The motivation for this dual-licensing is the additional software patent assurance provided by Apache 2.0.

Bluesky Social PBC has committed to a software patent non-aggression pledge. For details see [the original announcement](https://bsky.social/about/blog/10-01-2025-patent-pledge).
