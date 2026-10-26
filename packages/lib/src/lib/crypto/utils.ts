import { base58btc } from 'multiformats/bases/base58'

export const extractPrefixedBytes = (
  multikey: string,
): Uint8Array<ArrayBuffer> => {
  if (!multikey.startsWith(base58btc.prefix)) {
    throw new Error(`Incorrect prefix for multikey: ${multikey}`)
  }
  return base58btc.decoder.decode(multikey) as Uint8Array<ArrayBuffer>
}

export function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) {
    return false
  }
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) {
      return false
    }
  }

  return true
}
