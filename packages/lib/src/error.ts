export class ImproperOperationError extends Error {
  constructor(public reason: string, public op: unknown) {
    super(`Improperly formatted operation, ${reason}: ${op}`)
  }
}

export class MisorderedOperationError extends Error {
  constructor() {
    super('Operations not correctly ordered')
  }
}

export class LateRecoveryError extends Error {
  constructor(public timeLapsed: number) {
    super(
      `Recovery operation occured outside of the allowed 72 hr recovery window. Time lapsed: ${timeLapsed}`,
    )
  }
}

export class GenesisHashError extends Error {
  constructor(public expected: string) {
    super(
      `Hash of genesis operation does not match DID identifier: ${expected}`,
    )
  }
}

export class InvalidSignatureError extends Error {
  constructor(public op: unknown) {
    super(`Invalid signature on op: ${JSON.stringify(op)}`)
  }
}

export class UnsupportedKeyError extends Error {
  constructor(public key: string, public err: unknown) {
    super(`Unsupported key type ${key}: ${err}`)
  }
}
