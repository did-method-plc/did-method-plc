export class PlcError extends Error {
  plcError = true
  constructor(msg: string, options?: ErrorOptions) {
    super(msg, options)
  }

  static is(obj: unknown): obj is PlcError {
    if (
      obj &&
      typeof obj === 'object' &&
      (obj as Record<string, unknown>)['plcError'] === true
    ) {
      return true
    }
    return false
  }
}
export class ImproperOperationError extends PlcError {
  constructor(
    public reason: string,
    public op: unknown,
    options?: ErrorOptions,
  ) {
    super(`Improperly formatted operation, ${reason}: ${op}`, options)
  }
}

export class MisorderedOperationError extends PlcError {
  constructor(options?: ErrorOptions) {
    super('Operations not correctly ordered', options)
  }
}

export class LateRecoveryError extends PlcError {
  constructor(
    public timeLapsed: number,
    options?: ErrorOptions,
  ) {
    super(
      `Recovery operation occurred outside of the allowed 72 hr recovery window. Time lapsed: ${timeLapsed}`,
      options,
    )
  }
}

export class GenesisHashError extends PlcError {
  constructor(
    public expected: string,
    options?: ErrorOptions,
  ) {
    super(
      `Hash of genesis operation does not match DID identifier: ${expected}`,
      options,
    )
  }
}

export class InvalidSignatureError extends PlcError {
  constructor(
    public op: unknown,
    options?: ErrorOptions,
  ) {
    super(`Invalid signature on op: ${JSON.stringify(op)}`, options)
  }
}

export class UnsupportedKeyError extends PlcError {
  constructor(
    public key: string,
    public err: unknown,
    options?: ErrorOptions,
  ) {
    super(`Unsupported key type ${key}: ${err}`, options)
  }
}

export class ImproperlyFormattedDidError extends PlcError {
  constructor(
    public reason: string,
    options?: ErrorOptions,
  ) {
    super(`Improperly formatted did: ${reason}`, options)
  }
}
