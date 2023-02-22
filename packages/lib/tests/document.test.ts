import * as uint8arrays from 'uint8arrays'
import { EcdsaKeypair, parseDidKey, Secp256k1Keypair } from '@atproto/crypto'
import * as document from '../src/document'
import * as t from '../src/types'

describe('document', () => {
  it('formats a valid DID document', async () => {
    const signingKey = await Secp256k1Keypair.create()
    const rotate1 = await Secp256k1Keypair.create()
    const rotate2 = await EcdsaKeypair.create()
    const handles = ['alice.test', 'bob.test']
    const atpPds = 'https://example.com'
    const data: t.DocumentData = {
      did: 'did:example:alice',
      signingKey: signingKey.did(),
      rotationKeys: [rotate1.did(), rotate2.did()],
      handles,
      services: {
        atpPds,
      },
    }
    const doc = await document.formatDidDoc(data)
    expect(doc['@context']).toEqual([
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/secp256k1-2019/v1',
    ])
    expect(doc.id).toEqual(data.did)
    const formattedHandles = handles.map((h) => `https://${h}`)
    expect(doc.alsoKnownAs).toEqual(formattedHandles)
    expect(doc.verificationMethod.length).toBe(1)
    expect(doc.verificationMethod[0].id).toEqual('#signingKey')
    expect(doc.verificationMethod[0].type).toEqual(
      'EcdsaSecp256k1VerificationKey2019',
    )
    expect(doc.verificationMethod[0].controller).toEqual(data.did)
    const parsedSigningKey = parseDidKey(signingKey.did())
    const signingKeyMultibase =
      'z' + uint8arrays.toString(parsedSigningKey.keyBytes, 'base58btc')
    expect(doc.verificationMethod[0].publicKeyMultibase).toEqual(
      signingKeyMultibase,
    )
    expect(doc.assertionMethod).toEqual(['#signingKey'])
    expect(doc.capabilityInvocation).toEqual(['#signingKey'])
    expect(doc.capabilityDelegation).toEqual(['#signingKey'])
    expect(doc.service.length).toBe(1)
    expect(doc.service[0].id).toEqual('#atpPds')
    expect(doc.service[0].type).toEqual('AtpPersonalDataServer')
    expect(doc.service[0].serviceEndpoint).toEqual(atpPds)
  })

  it('handles P-256 keys', async () => {
    const signingKey = await EcdsaKeypair.create()
    const rotate1 = await Secp256k1Keypair.create()
    const rotate2 = await EcdsaKeypair.create()
    const handles = ['alice.test', 'bob.test']
    const atpPds = 'https://example.com'
    const data: t.DocumentData = {
      did: 'did:example:alice',
      signingKey: signingKey.did(),
      rotationKeys: [rotate1.did(), rotate2.did()],
      handles,
      services: {
        atpPds,
      },
    }
    const doc = await document.formatDidDoc(data)
    expect(doc.verificationMethod.length).toBe(1)
    expect(doc['@context']).toEqual([
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ecdsa-2019/v1',
    ])
    expect(doc.verificationMethod[0].id).toEqual('#signingKey')
    expect(doc.verificationMethod[0].type).toEqual(
      'EcdsaSecp256r1VerificationKey2019',
    )
    expect(doc.verificationMethod[0].controller).toEqual(data.did)
    const parsedSigningKey = parseDidKey(signingKey.did())
    const signingKeyMultibase =
      'z' + uint8arrays.toString(parsedSigningKey.keyBytes, 'base58btc')
    expect(doc.verificationMethod[0].publicKeyMultibase).toEqual(
      signingKeyMultibase,
    )
  })

  it('formats a valid DID document regardless of leading https://', async () => {
    const signingKey = await Secp256k1Keypair.create()
    const rotate1 = await Secp256k1Keypair.create()
    const rotate2 = await EcdsaKeypair.create()
    const handles = ['https://alice.test', 'bob.test']
    const atpPds = 'example.com'
    const data: t.DocumentData = {
      did: 'did:example:alice',
      signingKey: signingKey.did(),
      rotationKeys: [rotate1.did(), rotate2.did()],
      handles,
      services: {
        atpPds,
      },
    }
    const doc = await document.formatDidDoc(data)
    expect(doc.alsoKnownAs).toEqual(['https://alice.test', 'https://bob.test'])
    expect(doc.service[0].serviceEndpoint).toEqual(`https://${atpPds}`)
  })
})
