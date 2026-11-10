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
  // Standard filter: status=published,approved (TMF667 DocumentStatusType). Combined with lifecycleState by intersection.
  const tmf = params.get("status");
  if (tmf) {
    const parts = tmf.split(",").map((s) => s.trim());
    const bad = parts.find((p) => !(TMF_STATUSES as readonly string[]).includes(p));
    if (bad) return { ok: false, error: tmfError(400, "invalidQuery", "Bad Request", `Unknown status '${bad.slice(0, 32)}'.`) };
    const mapped = parts.flatMap((p) => statesForTmfStatus(p as TmfStatus));
    lifecycleState = lifecycleState ? lifecycleState.filter((x) => mapped.includes(x)) : mapped;
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
      referredType: (() => { const t = short("relatedEntity.@referredType"); return t ? fromStandardReferredType(t) : null; })(),
      documentType: short("documentType"),
      lifecycleState,
      externalId: short("externalIdentifier.id"),
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
  tenant_id?: string;
  external_identifier?: unknown;
  bundle_id?: string | null;
}

/** Extra read-only context for a document reply. */
export interface DocExtras {
  /** Business process names from the document type (TMF GB921), used as `category`. */
  category?: string[];
  /** Other visible documents in the same bundle (TMF DocumentRef). */
  related?: { id: string; role: string }[];
}

/** Category from a document type definition's businessProcess list. */
export function categoryFromDefinition(definition: unknown): string[] {
  const bp = typeof definition === "object" && definition !== null ? (definition as { businessProcess?: unknown }).businessProcess : undefined;
  if (!Array.isArray(bp)) return [];
  return bp.map((b) => (typeof b === "object" && b !== null ? (b as { name?: unknown }).name : null)).filter((n): n is string => typeof n === "string");
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

export interface ExternalIdentifier { id: string; owner?: string; externalIdentifierType?: string; "@type": "ExternalIdentifier" }

/**
 * TMF667 v4 Document. Standard fields first; our additions (sensitivity, legalHold, validFor,
 * lifecycleState, attachment contentHash/isCurrent) are declared by @type EradDocument + @schemaLocation.
 */
export interface TmfDocument {
  id: string;
  href: string;
  "@type": "EradDocument";
  "@baseType": "Document";
  "@schemaLocation": string;
  name: string;
  description?: string;
  documentType: string;
  status: TmfStatus;
  creationDate: string;
  lastUpdate: string;
  version?: string;
  documentSpecification: { id: string; "@referredType": "DocumentSpecification"; href: string; "@type": "DocumentSpecificationRef" };
  relatedEntity: { id: string; role: string; "@referredType": string; "@type": "RelatedEntity" }[];
  relatedParty: { id: string; role: "owner"; "@referredType": "Organization"; "@type": "RelatedParty" }[];
  externalIdentifier: ExternalIdentifier[];
  attachment: {
    id: string;
    href: string;
    "@type": "Attachment";
    name: string;
    attachmentType: string;
    mimeType: string;
    url: string;
    size?: { amount: number; units: "bytes" };
    contentHash: string;
    creationDate: string;
    isCurrent: boolean;
  }[];
  characteristic: { name: string; value: unknown; valueType?: string }[];
  category?: string[];
  document?: { id: string; href: string; role: string; "@referredType": "Document"; "@type": "DocumentRef" }[];
  // Extensions (EradDocument)
  lifecycleState: DocStatus;
  validFor?: { startDateTime?: string; endDateTime?: string };
  sensitivity: string;
  legalHold: boolean;
}

export function asExternalIdentifiers(value: unknown): ExternalIdentifier[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is { id: string; owner?: unknown; externalIdentifierType?: unknown } => typeof c === "object" && c !== null && typeof (c as { id?: unknown }).id === "string")
    .map((c) => ({
      id: c.id,
      ...(typeof c.owner === "string" ? { owner: c.owner } : {}),
      ...(typeof c.externalIdentifierType === "string" ? { externalIdentifierType: c.externalIdentifierType } : {}),
      "@type": "ExternalIdentifier" as const,
    }));
}

function asCharacteristics(value: unknown): TmfDocument["characteristic"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is { name: string; value: unknown; valueType?: string } => typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string")
    .map((c) => ({ name: c.name, value: c.value, ...(c.valueType ? { valueType: c.valueType } : {}) }));
}

export function toTmfDocument(origin: string, doc: DocRow, versions: VersionRow[], relations: RelationRow[], extras: DocExtras = {}): TmfDocument {
  const current = versions.find((v) => v.id === doc.current_version_id);
  const validFor =
    doc.effective_date || doc.expiry_date
      ? { ...(doc.effective_date ? { startDateTime: doc.effective_date } : {}), ...(doc.expiry_date ? { endDateTime: doc.expiry_date } : {}) }
      : undefined;
  const base = `${origin}${TMF_BASE_PATH}/document/${doc.id}`;
  return {
    id: doc.id,
    href: base,
    "@type": "EradDocument",
    "@baseType": "Document",
    "@schemaLocation": `${origin}${ERAD_SCHEMA_PATH}`,
    name: doc.name,
    ...(doc.description ? { description: doc.description } : {}),
    documentType: doc.document_type,
    status: toTmfStatus(doc.status),
    creationDate: doc.created_at,
    lastUpdate: doc.updated_at,
    ...(current ? { version: current.label } : {}),
    documentSpecification: {
      id: doc.document_type,
      "@referredType": "DocumentSpecification",
      "@type": "DocumentSpecificationRef",
      href: `${origin}${TMF_BASE_PATH}/documentSpecification/${doc.document_type}`,
    },
    relatedEntity: relations.map((r) => ({ id: r.entity_id, role: r.role, "@referredType": toStandardReferredType(r.referred_type), "@type": "RelatedEntity" })),
    relatedParty: doc.tenant_id ? [{ id: doc.tenant_id, role: "owner", "@referredType": "Organization", "@type": "RelatedParty" }] : [],
    externalIdentifier: asExternalIdentifiers(doc.external_identifier),
    attachment: versions.map((v) => ({
      id: v.id,
      href: `${base}/attachment/${v.id}`,
      "@type": "Attachment",
      name: `Version ${v.label}`,
      attachmentType: doc.document_type,
      mimeType: v.mime_type,
      // Returns a 60-second download link (same key needed).
      url: `${base}/attachment/${v.id}/content`,
      ...(v.size_bytes !== null ? { size: { amount: v.size_bytes, units: "bytes" as const } } : {}),
      contentHash: v.content_hash,
      creationDate: v.created_at,
      isCurrent: v.id === doc.current_version_id,
    })),
    characteristic: asCharacteristics(doc.characteristic),
    ...(extras.category && extras.category.length ? { category: extras.category } : {}),
    ...(extras.related && extras.related.length
      ? { document: extras.related.map((r) => ({ id: r.id, href: `${origin}${TMF_BASE_PATH}/document/${r.id}`, role: r.role, "@referredType": "Document" as const, "@type": "DocumentRef" as const })) }
      : {}),
    lifecycleState: doc.status,
    ...(validFor ? { validFor } : {}),
    sensitivity: doc.sensitivity,
    legalHold: doc.legal_hold,
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
    validFor?: unknown;
  };
  const chars = Array.isArray(def.specCharacteristic) ? def.specCharacteristic : [];
  const fileRules = [
    ...(Array.isArray(def.acceptedMimeTypes) && def.acceptedMimeTypes.length
      ? [{ name: "acceptedMimeType", valueType: "string", configurable: false, "@type": "CharacteristicSpecification", characteristicValueSpecification: def.acceptedMimeTypes.map((m) => ({ value: m, valueType: "string" })) }]
      : []),
    ...(typeof def.maxSizeMb === "number"
      ? [{ name: "maxSizeMb", valueType: "number", configurable: false, "@type": "CharacteristicSpecification", characteristicValueSpecification: [{ value: def.maxSizeMb, valueType: "number", unitOfMeasure: "MB" }] }]
      : []),
  ];
  return {
    id: s.code,
    href: `${origin}${TMF_BASE_PATH}/documentSpecification/${s.code}`,
    "@type": "DocumentSpecification" as const,
    name: s.name,
    version: s.version,
    lifecycleStatus: s.lifecycle_status,
    "@baseType": "EntitySpecification" as const,
    isBundle: false,
    targetEntitySchema: { "@type": "EradDocument", "@schemaLocation": `${origin}${ERAD_SCHEMA_PATH}` },
    specCharacteristic: [...chars, ...fileRules],
    ...(typeof def.validFor === "object" && def.validFor !== null ? { validFor: def.validFor } : {}),
    // Kept until the legacy address is retired; the same rules are in specCharacteristic.
    acceptedMimeTypes: Array.isArray(def.acceptedMimeTypes) ? def.acceptedMimeTypes : [],
    ...(typeof def.maxSizeMb === "number" ? { maxSizeMb: def.maxSizeMb } : {}),
  };
}

/** Internal outbox kinds → TMF667 v4 event names. */
const V4_EVENT: Record<string, string> = {
  DocumentCreateEvent: "DocumentCreateEvent",
  DocumentStateChangeEvent: "DocumentChangeEvent",
  DocumentAttributeValueChangeEvent: "DocumentChangeEvent",
  DocumentDeleteEvent: "DocumentDeleteEvent",
};
export const V4_EVENT_TYPES = ["DocumentCreateEvent", "DocumentChangeEvent", "DocumentBatchEvent", "DocumentDeleteEvent"] as const;
const LEGACY_ONLY = ["DocumentStateChangeEvent", "DocumentAttributeValueChangeEvent"];

export function v4EventType(internal: string): string {
  return V4_EVENT[internal] ?? internal;
}

/** Subscriptions that name an old event type keep receiving the old name until the legacy sunset. */
export function eventNameFor(query: string | null, internal: string): string {
  const wanted = parseEventTypes(query);
  if (wanted && wanted.includes(internal) && LEGACY_ONLY.includes(internal)) return internal;
  return v4EventType(internal);
}

function parseEventTypes(query: string | null): string[] | null {
  if (!query) return null;
  const m = /eventType=([A-Za-z,]+)/.exec(query);
  return m ? (m[1] ?? "").split(",") : null;
}

function queryValue(query: string, key: string): string[] | null {
  const m = new RegExp(`(?:^|[&;])${key.replace(".", "\\.")}=([^&;]+)`).exec(query);
  return m ? decodeURIComponent(m[1] ?? "").split(",") : null;
}

/**
 * TMF667 v4 event envelope. Carries a reference (id, href, status), never document content
 * or characteristic values: receivers fetch the resource with their own key.
 */
export function toTmfEvent(
  origin: string,
  row: { id: number; event_type: string; document_id: string; created_at: string; payload: unknown },
  query: string | null = null,
) {
  const p = (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as { lifecycleState?: string; previous?: string; documentIds?: unknown; action?: unknown };
  if (row.event_type === "DocumentBatchEvent") {
    const ids = Array.isArray(p.documentIds) ? p.documentIds.filter((x): x is string => typeof x === "string") : [];
    return {
      eventId: String(row.id),
      eventTime: row.created_at,
      timeOcurred: row.created_at,
      eventType: "DocumentBatchEvent",
      correlationId: `batch-${row.id}`,
      domain: "documentManagement",
      title: "Document batch event",
      description: `Bulk change to ${ids.length} document(s)`,
      priority: "normal",
      event: { document: ids.map((id) => ({ id, href: `${origin}${TMF_BASE_PATH}/document/${id}`, "@type": "Document" })) },
    };
  }
  const eventType = eventNameFor(query, row.event_type);
  const state = p.lifecycleState as DocStatus | undefined;
  const changed = row.event_type === "DocumentStateChangeEvent" ? ["status"] : row.event_type === "DocumentAttributeValueChangeEvent" ? ["attachment", "characteristic", "legalHold"] : undefined;
  return {
    eventId: String(row.id),
    eventTime: row.created_at,
    timeOcurred: row.created_at,
    eventType,
    correlationId: row.document_id,
    domain: "documentManagement",
    title: eventType.replace(/([a-z])([A-Z])/g, "$1 $2"),
    description: changed ? `Changed: ${changed.join(", ")}` : eventType.replace(/([a-z])([A-Z])/g, "$1 $2"),
    priority: "normal",
    event: {
      document: {
        id: row.document_id,
        href: `${origin}${TMF_BASE_PATH}/document/${row.document_id}`,
        "@type": "Document",
        ...(row.event_type === "DocumentDeleteEvent" ? { status: "deleted" } : state ? { status: toTmfStatus(state), lifecycleState: state } : {}),
      },
    },
    ...(changed ? { changedAttributes: changed } : {}),
  };
}

/**
 * Event subscription query (TMF630 style): eventType=A,B plus optional document filters
 * status=… and documentType=…. Old and new event names both match.
 */
export function eventMatches(query: string | null, eventType: string, doc?: { status?: DocStatus | null; documentType?: string | null }): boolean {
  const types = parseEventTypes(query);
  // Batch events go only to subscriptions that ask for them by name.
  if (eventType === "DocumentBatchEvent") return !!types && types.includes("DocumentBatchEvent");
  if (!query) return true;
  if (types && !types.includes(eventType) && !types.includes(v4EventType(eventType))) return false;
  const status = queryValue(query, "status");
  if (status && doc?.status && !status.includes(toTmfStatus(doc.status))) return false;
  const dt = queryValue(query, "documentType");
  if (dt && doc?.documentType && !dt.includes(doc.documentType)) return false;
  return true;
}

/** Signature covers timestamp and body so a captured event can't be replayed later. */
export function signedPayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}
export const SIGNATURE_TOLERANCE_SECONDS = 300;


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
  const m = /^Bearer\s+((?:erad_|eradt_)[A-Za-z0-9_-]{20,120})$/.exec(header.trim());
  return m?.[1] ?? null;
}

/** True for loopback, private, link-local, CGNAT and unique-local addresses (v4 and v6). */
export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.includes(":")) return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
  return /^(0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(v);
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
