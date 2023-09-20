import * as z from 'zod'
import * as mf from 'multiformats/cid'

const cid = z
  .any()
  .refine((obj: unknown) => mf.CID.asCID(obj) !== null, {
    message: 'Not a CID',
  })
  .transform((obj: unknown) => mf.CID.asCID(obj) as mf.CID)

const service = z.object({
  type: z.string(),
  endpoint: z.string(),
})

const documentData = z.object({
  did: z.string(),
  rotationKeys: z.array(z.string()),
  verificationMethods: z.record(z.string()),
  alsoKnownAs: z.array(z.string()),
  services: z.record(service),
})
export type DocumentData = z.infer<typeof documentData>

const unsignedCreateOpV1 = z.object({
  type: z.literal('create'),
  signingKey: z.string(),
  recoveryKey: z.string(),
  handle: z.string(),
  service: z.string(),
  prev: z.null(),
})
export type UnsignedCreateOpV1 = z.infer<typeof unsignedCreateOpV1>
const createOpV1 = unsignedCreateOpV1.extend({ sig: z.string() })
export type CreateOpV1 = z.infer<typeof createOpV1>

const unsignedOperation = z
  .object({
    type: z.literal('plc_operation'),
    rotationKeys: z.array(z.string()),
    verificationMethods: z.record(z.string()),
    alsoKnownAs: z.array(z.string()),
    services: z.record(service),
    prev: z.string().nullable(),
  })
  .strict()
export type UnsignedOperation = z.infer<typeof unsignedOperation>
const operation = unsignedOperation.extend({ sig: z.string() }).strict()
export type Operation = z.infer<typeof operation>

const unsignedTombstone = z
  .object({
    type: z.literal('plc_tombstone'),
    prev: z.string(),
  })
  .strict()
export type UnsignedTombstone = z.infer<typeof unsignedTombstone>
const tombstone = unsignedTombstone.extend({ sig: z.string() }).strict()
export type Tombstone = z.infer<typeof tombstone>

const opOrTombstone = z.union([operation, tombstone])
export type OpOrTombstone = z.infer<typeof opOrTombstone>
const compatibleOp = z.union([createOpV1, operation])
export type CompatibleOp = z.infer<typeof compatibleOp>
const compatibleOpOrTombstone = z.union([createOpV1, operation, tombstone])
export type CompatibleOpOrTombstone = z.infer<typeof compatibleOpOrTombstone>

export const indexedOperation = z.object({
  did: z.string(),
  operation: compatibleOpOrTombstone,
  cid: cid,
  nullified: z.boolean(),
  createdAt: z.date(),
})
export type IndexedOperation = z.infer<typeof indexedOperation>

export const exportedOp = z.object({
  did: z.string(),
  operation: compatibleOpOrTombstone,
  cid: z.string(),
  nullified: z.boolean(),
  createdAt: z.string(),
})
export type ExportedOp = z.infer<typeof exportedOp>

export const didDocVerificationMethod = z.object({
  id: z.string(),
  type: z.string(),
  controller: z.string(),
  publicKeyMultibase: z.string(),
})

export const didDocService = z.object({
  id: z.string(),
  type: z.string(),
  serviceEndpoint: z.string(),
})

export const didDocument = z.object({
  '@context': z.array(z.string()),
  id: z.string(),
  alsoKnownAs: z.array(z.string()),
  verificationMethod: z.array(didDocVerificationMethod),
  service: z.array(didDocService),
})
export type DidDocument = z.infer<typeof didDocument>

export const def = {
  documentData,
  createOpV1,
  unsignedOperation,
  operation,
  tombstone,
  opOrTombstone,
  compatibleOp,
  compatibleOpOrTombstone,
  indexedOperation,
  exportedOp,
  didDocument,
}
