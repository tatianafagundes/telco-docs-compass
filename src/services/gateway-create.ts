// POST /document: register a document with its first file. What the request may contain is in
// gateway-create-input.ts; storing the file and version is in gateway-document-store.ts.
import type { Json } from "@/integrations/supabase/types";
import { fetchBytes } from "@/services/gateway-fetch";
import { must } from "@/services/shared/must";
import {
  MAX_INLINE_BODY_CHARS,
  MAX_INLINE_BYTES,
  createSchema,
  decodeBase64,
  sha256Bytes,
  sizeBytes,
} from "@/services/gateway-create-input";
import { storeFirstVersion } from "@/services/gateway-document-store";
import { sha256Hex, tmfError } from "@/services/tmf667-mapper";
import { errorReply } from "@/services/gateway-reply";
import { authenticate, findDoc, loadTmfDocs, readJson } from "@/services/gateway-core";
import { audit, idempotent } from "@/services/gateway-idempotency";
// ---------- writes ----------

export async function createDocument(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "register");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx, MAX_INLINE_BODY_CHARS);
  if (!parsed.ok) return parsed.res;
  const input = createSchema.safeParse(parsed.body);
  if (!input.success)
    return errorReply(
      tmfError(
        400,
        "invalidBody",
        "Bad Request",
        "Check name, documentType, relatedEntity and attachment (mimeType plus contentHash, url or content).",
      ),
      ctx.requestId,
    );
  const d = input.data;
  const att = Array.isArray(d.attachment) ? d.attachment[0] : d.attachment;
  if (!att)
    return errorReply(
      tmfError(400, "invalidBody", "Bad Request", "Send one attachment."),
      ctx.requestId,
    );
  if (!att.contentHash && !att.url && !att.content)
    return errorReply(
      tmfError(400, "invalidBody", "Bad Request", "attachment needs contentHash, url or content."),
      ctx.requestId,
    );
  // Idempotency hashes the request without inline content to keep stored hashes small.
  const idemBody = {
    ...d,
    attachment: {
      ...att,
      content: att.content ? `sha256:${await sha256Hex(att.content)}` : undefined,
    },
  };
  return idempotent(request, ctx, "createDocument", idemBody, async () => {
    const ids = d.relatedEntity.map((r) => r.id);
    const { data: entities } = await ctx.admin
      .from("business_entities")
      .select("id")
      .in("id", ids)
      .eq("tenant_id", ctx.tenantId);
    if ((entities ?? []).length !== new Set(ids).size) {
      return {
        status: 404,
        body: tmfError(
          404,
          "relatedEntityNotFound",
          "Not Found",
          "One or more related entities don't exist for this organisation.",
        ),
      };
    }
    const { data: specs } = await ctx.admin.rpc("effective_specifications", {
      p_tenant: ctx.tenantId,
    });
    const spec = (specs ?? []).find((s) => s.code === d.documentType);
    if (!spec)
      return {
        status: 400,
        body: tmfError(
          400,
          "unknownDocumentType",
          "Bad Request",
          "This documentType isn't set up for this organisation.",
        ),
      };
    const def = spec.definition as {
      acceptedMimeTypes?: string[];
      maxSizeMb?: number;
      defaultSensitivity?: string;
      retentionPolicyRef?: string;
    };
    if (def.acceptedMimeTypes && !def.acceptedMimeTypes.includes(att.mimeType))
      return {
        status: 400,
        body: tmfError(
          400,
          "mimeNotAccepted",
          "Bad Request",
          "This file type isn't accepted for this documentType.",
        ),
      };

    // Get the bytes when the client sent them (inline) or pointed at them (url).
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    if (att.content) {
      bytes = decodeBase64(att.content);
      if (!bytes)
        return {
          status: 400,
          body: tmfError(
            400,
            "invalidContent",
            "Bad Request",
            "attachment.content must be base64.",
          ),
        };
      if (bytes.byteLength > MAX_INLINE_BYTES)
        return {
          status: 413,
          body: tmfError(
            413,
            "tooLarge",
            "Payload Too Large",
            "Inline content is limited to 5 MB; send a url or use the upload address.",
          ),
        };
    } else if (att.url) {
      bytes = await fetchBytes(att.url);
      if (!bytes)
        return {
          status: 422,
          body: tmfError(
            422,
            "attachmentUnreachable",
            "Unprocessable Entity",
            "We couldn't fetch the attachment url (public https, under 25 MB).",
          ),
        };
    }
    const size = bytes ? bytes.byteLength : sizeBytes(att.size);
    if (def.maxSizeMb && size && size > def.maxSizeMb * 1024 * 1024)
      return {
        status: 400,
        body: tmfError(400, "tooLarge", "Bad Request", "This file is larger than allowed."),
      };
    const hash = bytes ? await sha256Bytes(bytes) : (att.contentHash as string);
    if (bytes && att.contentHash && att.contentHash !== hash)
      return {
        status: 422,
        body: tmfError(
          422,
          "hashMismatch",
          "Unprocessable Entity",
          "The file doesn't match contentHash.",
        ),
      };

    const { data: doc, error } = await ctx.admin
      .from("documents")
      .insert({
        tenant_id: ctx.tenantId,
        name: d.name,
        description: d.description ?? null,
        document_type: d.documentType,
        status: "draft",
        // Bytes we received are hash-checked and stored; otherwise the client still has to upload.
        pipeline_state: bytes ? "ready" : "uploading",
        sensitivity: (def.defaultSensitivity ?? "internal") as
          "public" | "internal" | "confidential" | "restricted",
        retention_policy_id: def.retentionPolicyRef ?? null,
        // The schema allows uploaded/generated only; the activity log records which system sent it.
        origin: "uploaded",
        registered_by_client: ctx.clientId,
        external_identifier: (d.externalIdentifier ?? []) as unknown as Json,
        ...(d.characteristic ? { characteristic: d.characteristic as unknown as Json } : {}),
      })
      .select("id")
      .single();
    if (error)
      console.error(
        JSON.stringify({
          op: "tmf.createDocument",
          requestId: ctx.requestId,
          code: error.code,
        }),
      );
    if (error || !doc)
      return {
        status: 503,
        body: tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."),
      };
    const stored = await storeFirstVersion(ctx.admin, {
      documentId: doc.id,
      tenantId: ctx.tenantId,
      mimeType: att.mimeType,
      sizeBytes: size ?? null,
      contentHash: hash,
      bytes,
      related: d.relatedEntity,
    });
    if (!stored.ok) {
      console.error(
        JSON.stringify({ op: "tmf.createDocument", requestId: ctx.requestId, step: stored.step }),
      );
      return {
        status: 503,
        body: tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."),
      };
    }
    await audit(
      ctx,
      "upload",
      doc.id,
      bytes ? (att.url ? "Version 1 (fetched from url)" : "Version 1 (sent inline)") : "Version 1",
    );
    const created = await findDoc(ctx, doc.id);
    const [tmf] = created ? await loadTmfDocs(ctx, [created]) : [];
    return {
      status: 201,
      body: { ...tmf, ...(stored.uploadUrl ? { uploadUrl: stored.uploadUrl } : {}) },
    };
  });
}
