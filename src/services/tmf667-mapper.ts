// Pure mapping between our document model and TMF667 Document Management v4 resources,
// plus TMF630-style query parsing and errors. No I/O here; tested in __tests__/tmf667-mapper.test.ts.
import type { DocStatus } from "@/schemas/document";

/** Standard TMF667 v4 address (/tmf-api/document/v4) under the app's public API prefix. */
export const TMF_BASE_PATH = "/api/public/tmf-api/document/v4";
/** Earlier profile address; still served, with Deprecation/Sunset headers. */
export const LEGACY_BASE_PATH = "/api/public/tmf-api/documentManagement/v4";
export const LEGACY_SUNSET = "Mon, 10 May 2027 00:00:00 GMT";
/** Published JSON schema for our Document extension fields. */
export const ERAD_SCHEMA_PATH = "/tmf-schemas/EradDocument.schema.json";

export const SCOPES = ["read", "register", "transition", "approve", "hold", "delete", "subscribe"] as const;
export type Scope = (typeof SCOPES)[number];

export const SYSTEM_KINDS = ["orderCare", "ticketManagement", "crm", "cpq", "other"] as const;
export type SystemKind = (typeof SYSTEM_KINDS)[number];

/** TMF622/621/629/666/648 referred types our business entities map to. */
export const REFERRED_TYPES = ["ProductOrder", "TroubleTicket", "Customer", "BillingAccount", "Quote", "Agreement", "Site"] as const;

/** TMF667 v4 DocumentStatusType. */
export const TMF_STATUSES = ["created", "reviewed", "approved", "published", "archived", "deleted"] as const;
export type TmfStatus = (typeof TMF_STATUSES)[number];

const TO_TMF_STATUS: Record<DocStatus, TmfStatus> = {
  draft: "created",
  in_review: "reviewed",
  approved: "approved",
  effective: "published",
  superseded: "archived",
  expired: "archived",
  archived: "archived",
};

export function toTmfStatus(s: DocStatus, deleted = false): TmfStatus {
  return deleted ? "deleted" : TO_TMF_STATUS[s];
}

/** Internal states a TMF status filter matches. */
export function statesForTmfStatus(s: TmfStatus): DocStatus[] {
  return (Object.keys(TO_TMF_STATUS) as DocStatus[]).filter((k) => TO_TMF_STATUS[k] === s);
}

/** Target internal state when a client PATCHes `status`. null = not something a client can set. */
export function targetForTmfStatus(s: string): DocStatus | null {
  const m: Record<string, DocStatus> = { created: "draft", reviewed: "in_review", approved: "approved", published: "effective", archived: "archived" };
  return m[s] ?? null;
}

/** SID names: our records say "Account"; the standard type is BillingAccount. */
export function toStandardReferredType(t: string): string {
  return t === "Account" ? "BillingAccount" : t;
}
export function fromStandardReferredType(t: string): string {
  return t === "BillingAccount" ? "Account" : t;
}

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

export interface TmfError {
  code: string;
  reason: string;
  message: string;
  status: string;
  "@type": "Error";
}

export function tmfError(status: number, code: string, reason: string, message: string): TmfError {
  return { code, reason, message, status: String(status), "@type": "Error" };
}

/** Which scope a status transition needs. Approval is separate because of the detail-review gate. */
export function scopeForTransition(to: DocStatus): Scope {
  return to === "approved" ? "approve" : "transition";
}

export function hasScope(scopes: readonly string[], needed: Scope): boolean {
  return scopes.includes(needed);
}

export interface ListQuery {
  offset: number;
  limit: number;
  fields: string[] | null;
  relatedEntityId: string | null;
  referredType: string | null;
  documentType: string | null;
  lifecycleState: DocStatus[] | null;
  externalId: string | null;
}

const STATUSES: DocStatus[] = ["draft", "in_review", "approved", "effective", "superseded", "expired", "archived"];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: TmfError };

export function parseListQuery(params: URLSearchParams): ParseResult<ListQuery> {
  const num = (k: string, d: number) => {
    const v = params.get(k);
    if (v === null) return d;
    return /^\d+$/.test(v) ? Number(v) : NaN;
  };
  const offset = num("offset", 0);
  const limit = num("limit", DEFAULT_LIMIT);
  if (Number.isNaN(offset) || Number.isNaN(limit) || limit < 1) {
    return { ok: false, error: tmfError(400, "invalidQuery", "Bad Request", "offset and limit must be positive whole numbers.") };
  }
  const states = params.get("lifecycleState");
  let lifecycleState: DocStatus[] | null = null;
  if (states) {
    const parts = states.split(",").map((s) => s.trim());
    const bad = parts.find((p) => !STATUSES.includes(p as DocStatus));
    if (bad) return { ok: false, error: tmfError(400, "invalidQuery", "Bad Request", `Unknown lifecycleState '${bad.slice(0, 32)}'.`) };
    lifecycleState = parts as DocStatus[];
  }
  const short = (k: string) => {
    const v = params.get(k);
    return v ? v.slice(0, 64) : null;
  };
  const fields = params.get("fields");
  return {
    ok: true,
    value: {
      offset,
      limit: Math.min(limit, MAX_LIMIT),
      fields: fields ? fields.split(",").map((f) => f.trim()).filter(Boolean) : null,
      relatedEntityId: short("relatedEntity.id"),
      referredType: short("relatedEntity.@referredType"),
      documentType: short("documentType"),
      lifecycleState,
    },
  };
}

/** TMF630 field selection: id, href and @type are always kept. */
export function selectFields<T extends Record<string, unknown>>(resource: T, fields: string[] | null): Partial<T> {
  if (!fields) return resource;
  const keep = new Set(["id", "href", "@type", ...fields]);
  return Object.fromEntries(Object.entries(resource).filter(([k]) => keep.has(k))) as Partial<T>;
}

export interface DocRow {
  id: string;
  name: string;
  description: string | null;
  document_type: string;
  status: DocStatus;
  sensitivity: string;
  legal_hold: boolean;
  effective_date: string | null;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
  characteristic: unknown;
}

export interface VersionRow {
  id: string;
  label: string;
  mime_type: string;
  size_bytes: number | null;
  content_hash: string;
  created_at: string;
}

export interface RelationRow {
  entity_id: string;
  role: string;
  referred_type: string;
}

export interface TmfDocument {
  id: string;
  href: string;
  "@type": "Document";
  "@baseType": "Document";
  name: string;
  description?: string;
  documentType: string;
  lifecycleState: DocStatus;
  creationDate: string;
  lastUpdate: string;
  version?: string;
  validFor?: { startDateTime?: string; endDateTime?: string };
  sensitivity: string;
  legalHold: boolean;
  documentSpecification: { id: string; "@referredType": "DocumentSpecification"; href: string };
  relatedEntity: { id: string; role: string; "@referredType": string; "@type": "RelatedEntity" }[];
  attachment: {
    id: string;
    "@type": "Attachment";
    name: string;
    mimeType: string;
    size?: { amount: number; units: "bytes" };
    contentHash: string;
    creationDate: string;
    isCurrent: boolean;
  }[];
  characteristic: { name: string; value: unknown; valueType?: string }[];
}

function asCharacteristics(value: unknown): TmfDocument["characteristic"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is { name: string; value: unknown; valueType?: string } => typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string")
    .map((c) => ({ name: c.name, value: c.value, ...(c.valueType ? { valueType: c.valueType } : {}) }));
}

export function toTmfDocument(origin: string, doc: DocRow, versions: VersionRow[], relations: RelationRow[]): TmfDocument {
  const current = versions.find((v) => v.id === doc.current_version_id);
  const validFor =
    doc.effective_date || doc.expiry_date
      ? { ...(doc.effective_date ? { startDateTime: doc.effective_date } : {}), ...(doc.expiry_date ? { endDateTime: doc.expiry_date } : {}) }
      : undefined;
  return {
    id: doc.id,
    href: `${origin}${TMF_BASE_PATH}/document/${doc.id}`,
    "@type": "Document",
    "@baseType": "Document",
    name: doc.name,
    ...(doc.description ? { description: doc.description } : {}),
    documentType: doc.document_type,
    lifecycleState: doc.status,
    creationDate: doc.created_at,
    lastUpdate: doc.updated_at,
    ...(current ? { version: current.label } : {}),
    ...(validFor ? { validFor } : {}),
    sensitivity: doc.sensitivity,
    legalHold: doc.legal_hold,
    documentSpecification: {
      id: doc.document_type,
      "@referredType": "DocumentSpecification",
      href: `${origin}${TMF_BASE_PATH}/documentSpecification/${doc.document_type}`,
    },
    relatedEntity: relations.map((r) => ({ id: r.entity_id, role: r.role, "@referredType": r.referred_type, "@type": "RelatedEntity" })),
    attachment: versions.map((v) => ({
      id: v.id,
      "@type": "Attachment",
      name: `Version ${v.label}`,
      mimeType: v.mime_type,
      ...(v.size_bytes !== null ? { size: { amount: v.size_bytes, units: "bytes" as const } } : {}),
      contentHash: v.content_hash,
      creationDate: v.created_at,
      isCurrent: v.id === doc.current_version_id,
    })),
    characteristic: asCharacteristics(doc.characteristic),
  };
}

export interface SpecRow {
  id: string;
  code: string;
  name: string;
  version: string;
  lifecycle_status: string;
  definition: unknown;
}

export function toTmfSpecification(origin: string, s: SpecRow) {
  const def = (typeof s.definition === "object" && s.definition !== null ? s.definition : {}) as {
    specCharacteristic?: unknown;
    acceptedMimeTypes?: unknown;
    maxSizeMb?: unknown;
  };
  return {
    id: s.code,
    href: `${origin}${TMF_BASE_PATH}/documentSpecification/${s.code}`,
    "@type": "DocumentSpecification" as const,
    name: s.name,
    version: s.version,
    lifecycleStatus: s.lifecycle_status,
    specCharacteristic: Array.isArray(def.specCharacteristic) ? def.specCharacteristic : [],
    acceptedMimeTypes: Array.isArray(def.acceptedMimeTypes) ? def.acceptedMimeTypes : [],
    ...(typeof def.maxSizeMb === "number" ? { maxSizeMb: def.maxSizeMb } : {}),
  };
}

/** TMF688-style event envelope. Never carries document content or characteristic values. */
export function toTmfEvent(origin: string, row: { id: number; event_type: string; document_id: string; created_at: string; payload: unknown }) {
  const p = (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as { lifecycleState?: string };
  return {
    eventId: String(row.id),
    eventTime: row.created_at,
    eventType: row.event_type,
    event: {
      document: {
        id: row.document_id,
        href: `${origin}${TMF_BASE_PATH}/document/${row.document_id}`,
        "@type": "Document",
        ...(p.lifecycleState ? { lifecycleState: p.lifecycleState } : {}),
      },
    },
  };
}

/** Event subscription query: TMF688 "eventType=A,B" filter. Null matches everything. */
export function eventMatches(query: string | null, eventType: string): boolean {
  if (!query) return true;
  const m = /eventType=([A-Za-z,]+)/.exec(query);
  if (!m) return true;
  return (m[1] ?? "").split(",").includes(eventType);
}

export const RETRY_LIMIT = 5;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(erad_[A-Za-z0-9_-]{20,120})$/.exec(header.trim());
  return m?.[1] ?? null;
}

/** Callback addresses must be https and not point at internal hosts. */
export function isSafeCallback(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname;
    return !(h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(":"));
  } catch {
    return false;
  }
}
