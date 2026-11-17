// What a connected system may send to register a document (POST /document), and the small helpers
// that read it: the shapes TMF allows for related records, identifiers, characteristics and the
// attachment, plus base64 decoding, hashing and size reading.
//
// Does not touch the database or decide whether the request is allowed: tmf-gateway.ts does.
import { z } from "zod";

/** Inline base64 attachments (TMF attachment.content) may be larger than ordinary bodies. */
export const MAX_INLINE_BYTES = 5 * 1024 * 1024;
/** The same limit as it appears in the request text: base64 is 4/3 larger, plus room for the other fields. */
export const MAX_INLINE_BODY_CHARS = Math.ceil((MAX_INLINE_BYTES * 4) / 3) + 20_000;

export const relatedSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  "@referredType": z.string().max(64).optional(),
});
export const extIdSchema = z.object({
  id: z.string().min(1).max(100),
  owner: z.string().max(100).optional(),
  externalIdentifierType: z.string().max(64).optional(),
});
export const characteristicSchema = z.object({
  name: z.string().min(1).max(64),
  value: z.union([z.string().max(500), z.number(), z.boolean()]),
  valueType: z.string().max(32).optional(),
});

/** TMF AttachmentRefOrValue: file details only (we return an upload address), a url to fetch, or inline base64 content. */
export const attachmentSchema = z.object({
  mimeType: z.string().min(3).max(150),
  name: z.string().max(255).optional(),
  size: z
    .union([
      z.number().int().nonnegative(),
      z.object({ amount: z.number().nonnegative(), units: z.string().max(16).optional() }),
    ])
    .optional(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  url: z.string().url().max(1000).optional(),
  content: z.string().max(MAX_INLINE_BODY_CHARS).optional(),
  attachmentType: z.string().max(64).optional(),
  "@type": z.string().max(64).optional(),
});

export const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).optional(),
  documentType: z.string().min(1).max(64),
  relatedEntity: z.array(relatedSchema).min(1).max(5),
  // Standard: array of attachments (we accept exactly one file per new document). Legacy: a single object.
  attachment: z.union([z.array(attachmentSchema).min(1).max(1), attachmentSchema]),
  externalIdentifier: z.array(extIdSchema).max(10).optional(),
  characteristic: z.array(characteristicSchema).max(50).optional(),
  "@type": z.string().max(64).optional(),
  "@baseType": z.string().max(64).optional(),
});

export function sizeBytes(size: z.infer<typeof attachmentSchema>["size"]): number | undefined {
  if (size === undefined) return undefined;
  return typeof size === "number" ? size : Math.round(size.amount);
}

export async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function decodeBase64(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64.replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
