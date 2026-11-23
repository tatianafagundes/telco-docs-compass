// TMF667 basics shared by the rest: paths, scopes, statuses, the error shape, and the parsing of
// list queries. Pure: no I/O.
import type { DocStatus } from "@/schemas/document";
/** Standard TMF667 v4 address (/tmf-api/document/v4) under the app's public API prefix. */
export const TMF_BASE_PATH = "/api/public/tmf-api/document/v4";
/** Earlier profile address; still served, with Deprecation/Sunset headers. */
export const LEGACY_BASE_PATH = "/api/public/tmf-api/documentManagement/v4";
export const LEGACY_SUNSET = "Mon, 10 May 2027 00:00:00 GMT";
/** Published JSON schema for our Document extension fields. */
export const ERAD_SCHEMA_PATH = "/tmf-schemas/EradDocument.schema.json";

export const SCOPES = [
  "read",
  "register",
  "transition",
  "approve",
  "hold",
  "delete",
  "subscribe",
  // Processing keys (file hooks): exclusive, so such a key can do nothing else (D4).
  "scan",
  "extract",
] as const;
export type Scope = (typeof SCOPES)[number];

export const SYSTEM_KINDS = ["orderCare", "ticketManagement", "crm", "cpq", "other"] as const;
export type SystemKind = (typeof SYSTEM_KINDS)[number];

/** TMF622/621/629/666/648 referred types our business entities map to. */
export const REFERRED_TYPES = [
  "ProductOrder",
  "TroubleTicket",
  "Customer",
  "BillingAccount",
  "Quote",
  "Agreement",
  "Site",
] as const;

/** TMF667 v4 DocumentStatusType. */
export const TMF_STATUSES = [
  "created",
  "reviewed",
  "approved",
  "published",
  "archived",
  "deleted",
] as const;
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
  const m: Record<string, DocStatus> = {
    created: "draft",
    reviewed: "in_review",
    approved: "approved",
    published: "effective",
    archived: "archived",
  };
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

const STATUSES: DocStatus[] = [
  "draft",
  "in_review",
  "approved",
  "effective",
  "superseded",
  "expired",
  "archived",
];

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
    return {
      ok: false,
      error: tmfError(
        400,
        "invalidQuery",
        "Bad Request",
        "offset and limit must be positive whole numbers.",
      ),
    };
  }
  const states = params.get("lifecycleState");
  let lifecycleState: DocStatus[] | null = null;
  if (states) {
    const parts = states.split(",").map((s) => s.trim());
    const bad = parts.find((p) => !STATUSES.includes(p as DocStatus));
    if (bad)
      return {
        ok: false,
        error: tmfError(
          400,
          "invalidQuery",
          "Bad Request",
          `Unknown lifecycleState '${bad.slice(0, 32)}'.`,
        ),
      };
    lifecycleState = parts as DocStatus[];
  }
  // Standard filter: status=published,approved (TMF667 DocumentStatusType). Combined with lifecycleState by intersection.
  const tmf = params.get("status");
  if (tmf) {
    const parts = tmf.split(",").map((s) => s.trim());
    const bad = parts.find((p) => !(TMF_STATUSES as readonly string[]).includes(p));
    if (bad)
      return {
        ok: false,
        error: tmfError(
          400,
          "invalidQuery",
          "Bad Request",
          `Unknown status '${bad.slice(0, 32)}'.`,
        ),
      };
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
      fields: fields
        ? fields
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
        : null,
      relatedEntityId: short("relatedEntity.id"),
      referredType: (() => {
        const t = short("relatedEntity.@referredType");
        return t ? fromStandardReferredType(t) : null;
      })(),
      documentType: short("documentType"),
      lifecycleState,
      externalId: short("externalIdentifier.id"),
    },
  };
}

/** TMF630 field selection: id, href and @type are always kept. */
export function selectFields<T extends Record<string, unknown>>(
  resource: T,
  fields: string[] | null,
): Partial<T> {
  if (!fields) return resource;
  const keep = new Set(["id", "href", "@type", ...fields]);
  return Object.fromEntries(Object.entries(resource).filter(([k]) => keep.has(k))) as Partial<T>;
}
