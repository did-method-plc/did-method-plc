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
  parseDidKey,
  Secp256k1Keypair,
  type Keypair,
} from './lib/crypto.js'
export * from './lib/ipld.js'
