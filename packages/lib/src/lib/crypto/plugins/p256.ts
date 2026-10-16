import { p256 } from '@noble/curves/nist.js'
import { extractMultikey, formatDidKey } from '../did.js'
import { extractPrefixedBytes, hasPrefix } from '../utils.js'
import type { DidKeyPlugin, Keypair, VerifyOptions } from './types.js'

export const P256_DID_PREFIX = new Uint8Array([0x80, 0x24])
export const P256_JWT_ALG = 'ES256'

export const p256Plugin: DidKeyPlugin = {
  prefix: P256_DID_PREFIX,
  jwtAlg: P256_JWT_ALG,
  verifySignature,
  decompressPubkey,
}

function decompressPubkey(compressed: Uint8Array): Uint8Array {
  if (compressed.length !== 33) {
    throw new Error('Expected 33 byte compress pubkey')
  }
  return p256.Point.fromBytes(compressed).toBytes(false)
}

async function verifySignature(
  did: string,
  data: Uint8Array,
  sig: Uint8Array,
  opts?: VerifyOptions,
): Promise<boolean> {
  const prefixedBytes = extractPrefixedBytes(extractMultikey(did))
  if (!hasPrefix(prefixedBytes, P256_DID_PREFIX)) {
    throw new Error(`Not a P-256 did:key: ${did}`)
  }
  const keyBytes = prefixedBytes.slice(P256_DID_PREFIX.length)
  return verifySig(keyBytes, data, sig, opts)
}

async function verifySig(
  publicKey: Uint8Array,
  data: Uint8Array,
  sig: Uint8Array,
  opts?: VerifyOptions,
): Promise<boolean> {
  const allowMalleable = opts?.allowMalleableSig ?? false
  // noble-curves v1 accepted `format: undefined` to auto-detect compact vs DER;
  // v2 requires an explicit format, so derive it from the signature encoding
  // (compact sigs are exactly 64 bytes). The strict path only ever accepts
  // low-s compact signatures — reject any non-compact sig up front, since v2's
  // compact verify throws on a mismatched length rather than returning false.
  const isCompact = sig.length === 64
  if (!allowMalleable && !isCompact) {
    return false
  }
  return p256.verify(sig, data, publicKey, {
    format: isCompact ? 'compact' : 'der', // prevent DER-encoded signatures on the strict path
    lowS: !allowMalleable,
  })
}

export class P256Keypair implements Keypair {
  readonly jwtAlg = 'ES256' as const
  readonly publicKey: Uint8Array

  constructor(readonly privateKey: Uint8Array) {
    this.publicKey = p256.getPublicKey(privateKey)
  }

  static create(): Keypair {
    const privateKey = p256.utils.randomSecretKey()
    return new P256Keypair(privateKey)
  }

  did(): string {
    const compressed = p256.Point.fromBytes(this.publicKey).toBytes(true)
    return formatDidKey(P256_DID_PREFIX, compressed)
  }

  async sign(msg: Uint8Array): Promise<Uint8Array> {
    return p256.sign(msg, this.privateKey, { lowS: true })
  }
}
