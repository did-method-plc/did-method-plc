import * as crypto from '@atproto/crypto'
import * as t from './types'
import { UnsupportedKeyError } from './error'
import { ParsedMultikey } from '@atproto/crypto'

export const formatDidDoc = (data: t.DocumentData): t.DidDocument => {
  const context = [
    'https://www.w3.org/ns/did/v1',
    'https://w3id.org/security/multikey/v1',
  ]

  const verificationMethods: VerificationMethod[] = []
  for (const [keyid, key] of Object.entries(data.verificationMethods)) {
    const info = formatKeyAndContext(key)
    if (info.context && !context.includes(info.context)) {
      context.push(info.context)
    }
    verificationMethods.push({
      id: `${data.did}#${keyid}`,
      type: info.type,
      controller: data.did,
      publicKeyMultibase: info.publicKeyMultibase,
    })
  }

  const services: Service[] = []
  for (const [serviceId, service] of Object.entries(data.services)) {
    services.push({
      id: `#${serviceId}`,
      type: service.type,
      serviceEndpoint: service.endpoint,
    })
  }

  return {
    '@context': context,
    id: data.did,
    alsoKnownAs: data.alsoKnownAs,
    verificationMethod: verificationMethods,
    service: services,
  }
}

type VerificationMethod = {
  id: string
  type: string
  controller: string
  publicKeyMultibase: string
}

type Service = {
  id: string
  type: string
  serviceEndpoint: string
}

type KeyAndContext = {
  context?: string
  type: string
  publicKeyMultibase: string
}

const formatKeyAndContext = (key: string): KeyAndContext => {
  let keyInfo: ParsedMultikey
  try {
    keyInfo = crypto.parseDidKey(key)
  } catch (err) {
    return {
      // we can't specify a context for a key type we don't recognize
      type: 'Multikey',
      publicKeyMultibase: key.replace(/^(did:key:)/, ''),
    }
  }
  const { jwtAlg } = keyInfo

  if (jwtAlg === crypto.P256_JWT_ALG) {
    return {
      context: 'https://w3id.org/security/suites/ecdsa-2019/v1',
      type: 'Multikey',
      publicKeyMultibase: key.replace(/^(did:key:)/, ''),
    }
  } else if (jwtAlg === crypto.SECP256K1_JWT_ALG) {
    return {
      context: 'https://w3id.org/security/suites/secp256k1-2019/v1',
      type: 'Multikey',
      publicKeyMultibase: key.replace(/^(did:key:)/, ''),
    }
  }

  // this codepath might seem unreachable/redundant, but it's possible
  // parseDidKey() supports more key formats in future, before this function
  // can be updated likewise
  return {
    // we can't specify a context for a key type we don't recognize
    type: 'Multikey',
    publicKeyMultibase: key.replace(/^(did:key:)/, ''),
  }
}
