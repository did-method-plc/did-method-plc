import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha256'
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
  const point = p256.ProjectivePoint.fromHex(compressed)
  return point.toRawBytes(false)
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
  const msgHash = await sha256(data)
  return p256.verify(sig, msgHash, publicKey, {
    format: allowMalleable ? undefined : 'compact', // prevent DER-encoded signatures
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
    const privateKey = p256.utils.randomPrivateKey()
    return new P256Keypair(privateKey)
  }

  did(): string {
    const compressed = p256.ProjectivePoint.fromHex(this.publicKey).toRawBytes(
      true,
    )
    return formatDidKey(P256_DID_PREFIX, compressed)
  }

  async sign(msg: Uint8Array): Promise<Uint8Array> {
    const msgHash = sha256(msg)
    const sig = p256.sign(msgHash, this.privateKey, { lowS: true })
    return sig.toCompactRawBytes()
  }
}
