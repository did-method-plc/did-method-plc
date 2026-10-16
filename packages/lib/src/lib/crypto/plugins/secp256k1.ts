import { secp256k1 } from '@noble/curves/secp256k1.js'
import { extractMultikey, formatDidKey } from '../did.js'
import { extractPrefixedBytes, hasPrefix } from '../utils.js'
import type { DidKeyPlugin, Keypair, VerifyOptions } from './types.js'

export const SECP256K1_JWT_ALG = 'ES256K'
export const SECP256K1_DID_PREFIX = new Uint8Array([0xe7, 0x01])

export const secp256k1Plugin: DidKeyPlugin = {
  prefix: SECP256K1_DID_PREFIX,
  jwtAlg: SECP256K1_JWT_ALG,
  verifySignature,
  decompressPubkey,
}

function decompressPubkey(compressed: Uint8Array): Uint8Array {
  if (compressed.length !== 33) {
    throw new Error('Expected 33 byte compress pubkey')
  }
  return secp256k1.Point.fromBytes(compressed).toBytes(false)
}

async function verifySignature(
  did: string,
  data: Uint8Array,
  sig: Uint8Array,
  opts?: VerifyOptions,
): Promise<boolean> {
  const prefixedBytes = extractPrefixedBytes(extractMultikey(did))
  if (!hasPrefix(prefixedBytes, SECP256K1_DID_PREFIX)) {
    throw new Error(`Not a secp256k1 did:key: ${did}`)
  }
  const keyBytes = prefixedBytes.slice(SECP256K1_DID_PREFIX.length)
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
  return secp256k1.verify(sig, data, publicKey, {
    format: isCompact ? 'compact' : 'der', // prevent DER-encoded signatures on the strict path
    lowS: !allowMalleable,
  })
}

export class Secp256k1Keypair implements Keypair {
  static create(): Keypair {
    const privateKey = secp256k1.utils.randomSecretKey()
    return new Secp256k1Keypair(privateKey)
  }

  readonly jwtAlg = 'ES256K' as const
  readonly publicKey: Uint8Array

  constructor(readonly privateKey: Uint8Array) {
    this.publicKey = secp256k1.getPublicKey(privateKey)
  }

  did(): string {
    const compressed = secp256k1.Point.fromBytes(this.publicKey).toBytes(true)
    return formatDidKey(SECP256K1_DID_PREFIX, compressed)
  }

  async sign(msg: Uint8Array): Promise<Uint8Array> {
    return secp256k1.sign(msg, this.privateKey, { lowS: true })
  }
}
