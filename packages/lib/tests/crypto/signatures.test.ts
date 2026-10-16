// Adapted from `@atproto/crypto` (packages/crypto/tests/signatures.test.ts).
// Verifies the shared signature fixtures through the public `verifySignature`
// helper, including that malleable (high-S) and DER-encoded signatures are
// rejected unless `allowMalleableSig` is explicitly set.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as uint8arrays from 'uint8arrays'
import { beforeAll, describe, expect, it } from 'vitest'
import { verifySignature } from '../../src/lib/crypto/verify.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type TestVector = {
  algorithm: string
  publicKeyDid: string
  publicKeyMultibase: string
  messageBase64: string
  signatureBase64: string
  validSignature: boolean
  tags: string[]
}

describe('signatures', () => {
  let vectors: TestVector[]

  beforeAll(() => {
    vectors = JSON.parse(
      fs.readFileSync(`${__dirname}/signature-fixtures.json`).toString(),
    )
  })

  it('verifies secp256k1 and P-256 test vectors', async () => {
    for (const vector of vectors) {
      const messageBytes = uint8arrays.fromString(
        vector.messageBase64,
        'base64',
      )
      const signatureBytes = uint8arrays.fromString(
        vector.signatureBase64,
        'base64',
      )
      const verified = await verifySignature(
        vector.publicKeyDid,
        messageBytes,
        signatureBytes,
      )
      expect(verified).toEqual(vector.validSignature)
    }
  })

  it('verifies high-s signatures with explicit option', async () => {
    const highSVectors = vectors.filter((vec) => vec.tags.includes('high-s'))
    expect(highSVectors.length).toBeGreaterThanOrEqual(2)
    for (const vector of highSVectors) {
      const messageBytes = uint8arrays.fromString(
        vector.messageBase64,
        'base64',
      )
      const signatureBytes = uint8arrays.fromString(
        vector.signatureBase64,
        'base64',
      )
      const verified = await verifySignature(
        vector.publicKeyDid,
        messageBytes,
        signatureBytes,
        { allowMalleableSig: true },
      )
      expect(verified).toEqual(true)
      expect(vector.validSignature).toEqual(false) // otherwise would fail per low-s requirement
    }
  })

  it('verifies der-encoded signatures with explicit option', async () => {
    const DERVectors = vectors.filter((vec) => vec.tags.includes('der-encoded'))
    expect(DERVectors.length).toBeGreaterThanOrEqual(2)
    for (const vector of DERVectors) {
      const messageBytes = uint8arrays.fromString(
        vector.messageBase64,
        'base64',
      )
      const signatureBytes = uint8arrays.fromString(
        vector.signatureBase64,
        'base64',
      )
      const verified = await verifySignature(
        vector.publicKeyDid,
        messageBytes,
        signatureBytes,
        { allowMalleableSig: true },
      )
      expect(verified).toEqual(true)
      expect(vector.validSignature).toEqual(false) // otherwise would fail per low-s requirement
    }
  })
})
