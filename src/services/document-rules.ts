// Pure document rules (no database), shared by the server functions and covered by tests.
import type { DocStatus, PipelineState } from "@/schemas/document";

export type AppRole = "viewer" | "contributor" | "reviewer" | "manager" | "tenant_admin" | "master_admin";

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

export type SeamResult<T> = { ok: true; data: T } | { ok: false; error: SeamError };

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
    customerFacing: { key: code, recoverable: nextAction !== "none", nextAction, ...(detail ? { detail } : {}) },
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
    .filter((c) => !fields.some((f) => f.name === c.name && (f.status === "accepted" || f.status === "edited")))
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

export function deleteBlocker(f: DeleteFacts): SeamError | null {
  if (f.legalHold) {
    return seamError("doc.delete.legalHold", "conflict", "none", f.holdReason ?? undefined);
  }
  if (f.retainUntil && f.retainUntil > f.today) {
    return seamError("doc.delete.retention", "conflict", "none", f.retainUntil);
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

export type IdempotencyOutcome = { kind: "fresh" } | { kind: "replay"; response: unknown } | { kind: "conflict" };

export function idempotencyOutcome(
  stored: { request_hash: string; response: unknown } | null,
  requestHash: string,
): IdempotencyOutcome {
  if (!stored) return { kind: "fresh" };
  return stored.request_hash === requestHash ? { kind: "replay", response: stored.response } : { kind: "conflict" };
}

export const IDEMPOTENCY_TTL_HOURS = 24;
