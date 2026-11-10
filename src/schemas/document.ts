import { z } from "zod";

// Input schemas for the document seam (contracts/seams/document.openapi.yaml).
// Every write carries an idempotency key in the form "<uuid>:document.<operation>".

export const DOC_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "effective",
  "superseded",
  "expired",
  "archived",
] as const;
export const PIPELINE_STATES = ["uploading", "scanning", "reading", "ready", "failed", "quarantined"] as const;
export const SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;

export const docStatusSchema = z.enum(DOC_STATUSES);
export type DocStatus = z.infer<typeof docStatusSchema>;
export type PipelineState = (typeof PIPELINE_STATES)[number];

const idempotencyKey = z.string().min(8).max(200);
const docId = z.string().uuid();
const characteristic = z
  .array(z.object({ name: z.string().min(1).max(80), value: z.unknown() }))
  .max(50);
const contentHash = z.string().regex(/^sha256:[0-9a-f]{6,64}$/);

export const findSchema = z.object({
  entityId: z.string().min(1).max(64).optional(),
  documentType: z.array(z.string().max(64)).max(20).optional(),
  status: z.array(docStatusSchema).max(7).optional(),
  pipelineState: z.array(z.enum(PIPELINE_STATES)).max(6).optional(),
  text: z.string().trim().max(120).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().regex(/^\d+$/).optional(),
});

export const registerSchema = z.object({
  idempotencyKey,
  name: z.string().trim().min(1).max(255),
  documentType: z.string().min(1).max(64),
  relatedEntity: z.object({ id: z.string().min(1).max(64), role: z.string().min(1).max(64) }),
  mimeType: z.string().min(3).max(150),
  size: z.number().int().nonnegative().optional(),
  sensitivity: z.enum(SENSITIVITIES).optional(),
  characteristic: characteristic.optional(),
  // Divergence: the file hash is computed in the browser before upload, because versions are immutable.
  contentHash,
});

export const updateMetadataSchema = z.object({
  idempotencyKey,
  id: docId,
  patch: z
    .object({
      keepUnread: z.boolean().optional(),
      name: z.string().trim().min(1).max(255).optional(),
      description: z.string().max(2000).optional(),
      sensitivity: z.enum(SENSITIVITIES).optional(),
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      characteristic: characteristic.optional(),
    })
    .strict(),
});

export const addVersionSchema = z
  .object({
    idempotencyKey,
    id: docId,
    mimeType: z.string().min(3).max(150),
    label: z.string().trim().min(1).max(60).optional(),
    note: z.string().max(280).optional(),
    isNamed: z.boolean().optional(),
    restoreFromVersionId: z.string().uuid().optional(),
    contentHash: contentHash.optional(),
    size: z.number().int().nonnegative().optional(),
  })
  .refine((v) => Boolean(v.restoreFromVersionId) || Boolean(v.contentHash), {
    message: "contentHash is required for a new upload",
  });

export const contentUrlSchema = z.object({ id: docId, purpose: z.enum(["preview", "download"]) });

export const transitionSchema = z.object({
  idempotencyKey,
  id: docId,
  to: docStatusSchema,
  comment: z.string().max(280).optional(),
});

export const setHoldSchema = z
  .object({ idempotencyKey, id: docId, active: z.boolean(), reason: z.string().trim().max(120).optional() })
  .refine((v) => !v.active || Boolean(v.reason), { message: "reason is required to set a hold" });

export const docWriteSchema = z.object({ idempotencyKey, id: docId });

export const reportProblemSchema = z.object({
  idempotencyKey,
  id: docId,
  kind: z.enum(["security", "unreadable", "sendBack"]),
  reason: z.enum(["threat", "wrongDocument", "wrongEntity", "unreadablePages", "other"]),
  comment: z.string().max(280).optional(),
});

const subject = z.object({ type: z.enum(["user", "tenant"]), id: z.string().min(1).max(64) });

export const grantAccessSchema = z
  .object({
    idempotencyKey,
    id: docId,
    subject,
    level: z.enum(["view", "edit"]),
    expiresAt: z.string().datetime().optional(),
    reason: z.string().trim().max(160).optional(),
  })
  .refine((v) => v.subject.type !== "tenant" || (Boolean(v.reason) && Boolean(v.expiresAt)), {
    message: "reason and expiry are required for a tenant grant",
  });

export const revokeAccessSchema = z.object({ idempotencyKey, id: docId, subject });

export const reviewExtractionSchema = z
  .object({
    idempotencyKey,
    id: docId,
    fieldId: z.string().uuid(),
    decision: z.enum(["accept", "edit", "reject"]),
    value: z.unknown().optional(),
  })
  .refine((v) => v.decision !== "edit" || v.value !== undefined, { message: "value is required to edit" });
