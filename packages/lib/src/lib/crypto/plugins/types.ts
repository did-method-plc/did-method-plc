export interface Keypair {
  readonly jwtAlg: string
  readonly privateKey: Uint8Array
  readonly publicKey: Uint8Array
  sign(msg: Uint8Array): Promise<Uint8Array>
  did(): string
}

export type DidKeyPlugin = {
  prefix: Uint8Array
  jwtAlg: string

  verifySignature: (
    did: string,
    msg: Uint8Array,
    data: Uint8Array,
    opts?: VerifyOptions,
  ) => Promise<boolean>

  decompressPubkey: (compressed: Uint8Array) => Uint8Array
}

export type VerifyOptions = {
  allowMalleableSig?: boolean
}
