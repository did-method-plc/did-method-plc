export * from './client.js'
export * from './data.js'
export * from './document.js'
export * from './error.js'
export * from './operations.js'
export * from './types.js'

export {
  extractMultikey,
  extractPrefixedBytes,
  P256Keypair,
  Secp256k1Keypair,
  p256Plugin,
  parseDidKey,
  secp256k1Plugin,
  type Keypair,
} from './lib/crypto.js'
export { cborEncode, cidForCbor } from './lib/ipld.js'
