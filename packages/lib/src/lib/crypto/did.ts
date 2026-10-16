import * as uint8arrays from 'uint8arrays'
import { plugins } from './plugins.js'
import { extractPrefixedBytes, hasPrefix } from './utils.js'

export const DID_KEY_PREFIX = 'did:key:'

export function extractMultikey(did: string): string {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error(`Incorrect prefix for did:key: ${did}`)
  }
  return did.slice(DID_KEY_PREFIX.length)
}

export type ParsedMultikey = {
  jwtAlg: string
  keyBytes: Uint8Array
}

function parseMultikey(multikey: string): ParsedMultikey {
  const prefixedBytes = extractPrefixedBytes(multikey)
  const plugin = plugins.find((p) => hasPrefix(prefixedBytes, p.prefix))
  if (!plugin) {
    throw new Error('Unsupported key type')
  }
  const keyBytes = plugin.decompressPubkey(
    prefixedBytes.slice(plugin.prefix.length),
  )
  return {
    jwtAlg: plugin.jwtAlg,
    keyBytes,
  }
}

export function parseDidKey(did: string): ParsedMultikey {
  const multikey = extractMultikey(did)
  return parseMultikey(multikey)
}

export function formatDidKey(
  prefix: Uint8Array,
  compressedPubkey: Uint8Array,
): `did:key:z${string}` {
  const prefixedBytes = uint8arrays.concat([prefix, compressedPubkey])
  return `did:key:z${uint8arrays.toString(prefixedBytes, 'base58btc')}`
}
