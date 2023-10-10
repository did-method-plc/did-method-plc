import { P256Keypair, parseDidKey, Secp256k1Keypair } from '@atproto/crypto'
import * as document from '../src/document'
import * as t from '../src/types'

describe('document', () => {
  it('formats a valid DID document', async () => {
    const atprotoKey = await Secp256k1Keypair.create()
    const otherKey = await P256Keypair.create()
    const rotate1 = await Secp256k1Keypair.create()
    const rotate2 = await P256Keypair.create()
    const alsoKnownAs = ['at://alice.test', 'https://bob.test']
    const atpPds = 'https://example.com'
    const otherService = 'https://other.com'
    const data: t.DocumentData = {
      did: 'did:example:alice',
      verificationMethods: {
        atproto: atprotoKey.did(),
        other: otherKey.did(),
      },
      rotationKeys: [rotate1.did(), rotate2.did()],
      alsoKnownAs,
      services: {
        atproto_pds: {
          type: 'AtprotoPersonalDataServer',
          endpoint: atpPds,
        },
        other: {
          type: 'SomeService',
          endpoint: otherService,
        },
      },
    }
    const doc = await document.formatDidDoc(data)
    // only expected keys
    expect(Object.keys(doc).sort()).toEqual(
      ['@context', 'id', 'alsoKnownAs', 'verificationMethod', 'service'].sort(),
    )
    expect(doc['@context']).toEqual([
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/secp256k1-2019/v1',
      'https://w3id.org/security/suites/ecdsa-2019/v1',
    ])
    expect(doc.id).toEqual(data.did)
    expect(doc.alsoKnownAs).toEqual(alsoKnownAs)

    expect(doc.verificationMethod.length).toBe(2)

    expect(doc.verificationMethod[0].id).toEqual(data.did + '#atproto')
    expect(doc.verificationMethod[0].type).toEqual('Multikey')
    expect(doc.verificationMethod[0].controller).toEqual(data.did)
    parseDidKey(atprotoKey.did())
    const atprotoKeyMultibase = atprotoKey.did().replace(/^(did:key:)/, '')
    expect(doc.verificationMethod[0].publicKeyMultibase).toEqual(
      atprotoKeyMultibase,
    )

    expect(doc.verificationMethod[1].id).toEqual(data.did + '#other')
    expect(doc.verificationMethod[1].type).toEqual('Multikey')
    expect(doc.verificationMethod[1].controller).toEqual(data.did)
    parseDidKey(otherKey.did())
    const otherKeyMultibase = otherKey.did().replace(/^(did:key:)/, '')
    expect(doc.verificationMethod[1].publicKeyMultibase).toEqual(
      otherKeyMultibase,
    )

    expect(doc.service.length).toBe(2)
    expect(doc.service[0].id).toEqual('#atproto_pds')
    expect(doc.service[0].type).toEqual('AtprotoPersonalDataServer')
    expect(doc.service[0].serviceEndpoint).toEqual(atpPds)
    expect(doc.service[1].id).toEqual('#other')
    expect(doc.service[1].type).toEqual('SomeService')
    expect(doc.service[1].serviceEndpoint).toEqual(otherService)
  })
})
