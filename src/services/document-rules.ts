// Pure document rules (no database), shared by the server functions and covered by tests.
import type { DocStatus, PipelineState } from "@/schemas/document";

export type AppRole =
  "viewer" | "contributor" | "reviewer" | "manager" | "tenant_admin" | "master_admin";

export interface SeamError {
  code: string;
  category: "validation" | "notFound" | "conflict" | "rejected" | "unavailable" | "unknown";
  retryable: boolean;
  customerFacing?: {
    key: string;
    recoverable?: boolean;
    nextAction?: "retry" | "fixInput" | "contactSupport" | "none";
    /** Plain-language reason that may be shown, e.g. a hold reference. Never personal data. */
    detail?: string;
  };
}

export type SeamErr = { ok: false; error: SeamError };
export type SeamResult<T> = { ok: true; data: T } | SeamErr;

export function seamError(
  code: string,
  category: SeamError["category"],
  nextAction: NonNullable<SeamError["customerFacing"]>["nextAction"] = "none",
  detail?: string,
): SeamError {
  return {
    code,
    category,
    retryable: category === "unavailable",
    customerFacing: {
      key: code,
      recoverable: nextAction !== "none",
      nextAction,
      ...(detail ? { detail } : {}),
    },
  };
}

const ROLE_RANK: Record<AppRole, number> = {
  viewer: 0,
  contributor: 1,
  reviewer: 2,
  manager: 3,
  tenant_admin: 4,
  master_admin: 4,
};

export type Capability = "edit" | "review" | "manage";
const CAPABILITY_MIN: Record<Capability, AppRole> = {
  edit: "contributor",
  review: "reviewer",
  manage: "manager",
};

export function can(role: AppRole, capability: Capability): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[CAPABILITY_MIN[capability]];
}

export type ShareLevel = "view" | "edit" | "manage";
const LEVEL_RANK: Record<ShareLevel, number> = { view: 0, edit: 1, manage: 2 };
/** The strongest share that is still live, or null when none is. */
export function strongestShare(
  shares: readonly { level: string; expires_at: string | null }[],
  now: Date,
): ShareLevel | null {
  let best: ShareLevel | null = null;
  for (const s of shares) {
    if (s.expires_at && new Date(s.expires_at) <= now) continue;
    const l = s.level as ShareLevel;
    if (!(l in LEVEL_RANK)) continue;
    if (best === null || LEVEL_RANK[l] > LEVEL_RANK[best]) best = l;
  }
  return best;
}
/**
 * What someone may do with a document they reach only through a share: the share level caps
 * their role. "Can view" allows nothing that changes it; "Can edit" allows a contributor's work
 * at most. Record-scoped work (review, approve, manage access) needs access to the record.
 * The screens and the server use this same rule.
 */
export function shareCappedRole(role: AppRole, level: ShareLevel): AppRole {
  if (level === "view") return "viewer";
  return can(role, "edit") ? "contributor" : "viewer";
}
/**
 * Adding a document or a new version. The group administrator works with the settings and
 * counts of the countries, never with their documents, so the server refuses it too (the
 * screens already hide it). Everyone else needs edit rights.
 */
export function addDocumentsBlocker(role: AppRole): SeamError | null {
  if (role === "master_admin") return seamError("access.groupAdminNoDocuments", "rejected");
  if (!can(role, "edit")) return seamError("access.roleTooLow", "rejected", "contactSupport");
  return null;
}

/** Forward-only status path. in_review -> draft happens only through reportProblem (sendBack). */
export const ALLOWED_TRANSITIONS: Record<DocStatus, DocStatus[]> = {
  draft: ["in_review"],
  in_review: ["approved"],
  approved: ["effective"],
  effective: ["superseded", "expired"],
  superseded: ["archived"],
  expired: ["archived"],
  archived: [],
};

export function transitionCapability(to: DocStatus): Capability {
  if (to === "in_review") return "edit";
  if (to === "approved") return "review";
  return "manage";
}

export function isTransitionAllowed(from: DocStatus, to: DocStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const FROZEN_STATUSES: DocStatus[] = ["superseded", "expired", "archived"];
export function isFrozen(status: DocStatus): boolean {
  return FROZEN_STATUSES.includes(status);
}

// Approved/effective: name and description stay editable; approved content (file, confirmed details, dates) is protected.
export const APPROVED_STATUSES: DocStatus[] = ["approved", "effective"];
export function contentProtected(status: DocStatus): boolean {
  return APPROVED_STATUSES.includes(status);
}
export const ALWAYS_EDITABLE_FIELDS = [
  "name",
  "description",
  "sensitivity",
  "externalIdentifier",
  "relatedEntity",
] as const;
export type PatchCheck =
  | { ok: true }
  | { ok: false; reason: "frozen" }
  | { ok: false; reason: "approvedContent"; blocked: string[] };
export function metadataPatchAllowed(status: DocStatus, changedFields: string[]): PatchCheck {
  if (changedFields.length === 0) return { ok: true };
  if (isFrozen(status)) return { ok: false, reason: "frozen" };
  if (!contentProtected(status)) return { ok: true };
  const allowed: readonly string[] = ALWAYS_EDITABLE_FIELDS;
  const blocked = changedFields.filter((f) => !allowed.includes(f));
  return blocked.length ? { ok: false, reason: "approvedContent", blocked } : { ok: true };
}

/** True when the text starts with a real calendar day written YYYY-MM-DD ("2027-02-30" is not one). */
export function startsWithCalendarDay(text: string): boolean {
  const day = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export interface SpecCharacteristic {
  name: string;
  required?: boolean;
  extractable?: boolean;
}
export interface FieldState {
  name: string;
  status: "pending" | "accepted" | "edited" | "rejected";
}

/** Required extractable details that still lack an accepted or edited value. */
export function pendingRequiredDetails(spec: SpecCharacteristic[], fields: FieldState[]): string[] {
  return spec
    .filter((c) => c.required && c.extractable)
    .filter(
      (c) =>
        !fields.some(
          (f) => f.name === c.name && (f.status === "accepted" || f.status === "edited"),
        ),
    )
    .map((c) => c.name);
}

export interface DeleteFacts {
  legalHold: boolean;
  holdReason: string | null;
  retainUntil: string | null; // yyyy-mm-dd
  createdAt: string; // ISO
  minRetentionDays: number | null; // master hard floor
  today: string; // yyyy-mm-dd
}

/**
 * A keep-until date means "kept through the end of that day": on the date itself the document is
 * still protected, and the first day it can go is the next one. Every way of deleting uses this.
 */
export function retentionHolds(retainUntil: string | null | undefined, today: string): boolean {
  return !!retainUntil && retainUntil >= today;
}

export function deleteBlocker(f: DeleteFacts): SeamError | null {
  if (f.legalHold) {
    return seamError("doc.delete.legalHold", "conflict", "none", f.holdReason ?? undefined);
  }
  if (retentionHolds(f.retainUntil, f.today)) {
    return seamError("doc.delete.retention", "conflict", "none", f.retainUntil ?? undefined);
  }
  if (f.minRetentionDays && f.minRetentionDays > 0) {
    const floor = new Date(f.createdAt);
    floor.setUTCDate(floor.getUTCDate() + f.minRetentionDays);
    const floorDay = floor.toISOString().slice(0, 10);
    if (floorDay > f.today) return seamError("doc.delete.retention", "conflict", "none", floorDay);
  }
  return null;
}

export const LOCKED_PIPELINE_STATES: PipelineState[] = ["scanning", "quarantined"];
export function contentLocked(state: PipelineState): boolean {
  return LOCKED_PIPELINE_STATES.includes(state);
}

/** Seeded rows have no stored object: their preview is the generated sample pages. */
export function isSampleStorage(path: string | null): boolean {
  return path === null || path.startsWith("sample/");
}

export const PREVIEW_URL_SECONDS = 300;
export const DOWNLOAD_URL_SECONDS = 60;
/** How long an upload address stays valid. Storage fixes it at two hours; the screens show it. */
export const UPLOAD_URL_SECONDS = 2 * 3600;

/** Deterministic JSON so the same body always hashes the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export async function hashBody(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type IdempotencyOutcome =
  { kind: "fresh" } | { kind: "replay"; response: unknown } | { kind: "conflict" };

export function idempotencyOutcome(
  stored: { request_hash: string; response: unknown } | null,
  requestHash: string,
): IdempotencyOutcome {
  if (!stored) return { kind: "fresh" };
  return stored.request_hash === requestHash
    ? { kind: "replay", response: stored.response }
    : { kind: "conflict" };
}

export const IDEMPOTENCY_TTL_HOURS = 24;
/** Saved answers made before this instant no longer count, whether or not the scheduled cleanup removed them yet. */
export const idempotencyCutoff = (now = Date.now()) =>
  new Date(now - IDEMPOTENCY_TTL_HOURS * 3600_000).toISOString();
/** The columns that identify one saved answer. */
export const IDEMPOTENCY_KEY_COLUMNS = "tenant_id,actor,key,operation";

/**
 * Four-eyes over the API. A system key may not approve:
 *  - a document it registered itself, and
 *  - a document added in the app by the person who connected that system (they would be approving
 *    their own work through their own key).
 * Documents registered by another system, or added by someone else, can be approved.
 */
export function systemMayApprove(
  doc: { registeredByClient?: string | null | undefined; createdBy?: string | null | undefined },
  system: { clientId: string; ownerId?: string | null | undefined },
): boolean {
  if (doc.registeredByClient && doc.registeredByClient === system.clientId) return false;
  if (doc.createdBy && system.ownerId && doc.createdBy === system.ownerId) return false;
  return true;
}
