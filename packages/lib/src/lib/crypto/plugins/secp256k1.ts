import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
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
  const point = secp256k1.ProjectivePoint.fromHex(compressed)
  return point.toRawBytes(false)
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
  const msgHash = await sha256(data)
  return secp256k1.verify(sig, msgHash, publicKey, {
    format: allowMalleable ? undefined : 'compact', // prevent DER-encoded signatures
    lowS: !allowMalleable,
  })
}

export class Secp256k1Keypair implements Keypair {
  static create(): Keypair {
    const privateKey = secp256k1.utils.randomPrivateKey()
    return new Secp256k1Keypair(privateKey)
  }

  readonly jwtAlg = 'ES256K' as const
  readonly publicKey: Uint8Array

  constructor(readonly privateKey: Uint8Array) {
    this.publicKey = secp256k1.getPublicKey(privateKey)
  }

  did(): string {
    const compressed = secp256k1.ProjectivePoint.fromHex(
      this.publicKey,
    ).toRawBytes(true)
    return formatDidKey(SECP256K1_DID_PREFIX, compressed)
  }

  async sign(msg: Uint8Array): Promise<Uint8Array> {
    const msgHash = sha256(msg)
    const sig = secp256k1.sign(msgHash, this.privateKey, { lowS: true })
    return sig.toCompactRawBytes()
  }
}
