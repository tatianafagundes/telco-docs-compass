// Pure rules for document search at scale: filters, keyset cursors, count labels and bulk eligibility.
// Tested in __tests__/search-rules.test.ts.
import { z } from "zod";
import type { DocStatus } from "@/schemas/document";
import { can, isFrozen, isTransitionAllowed, transitionCapability, type AppRole } from "@/services/document-rules";

export const PAGE_SIZE = 50;
export const COUNT_CAP = 10_000;
export const BULK_LIMIT = 10_000;
export const BULK_BATCH = 200;

export const SORTS = ["updated", "name", "expiry"] as const;
export type SortKey = (typeof SORTS)[number];

export const STATUSES: DocStatus[] = ["draft", "in_review", "approved", "effective", "superseded", "expired", "archived"];
export const SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;
export const ENTITY_TYPES = ["ProductOrder", "Quote", "Agreement", "BillingAccount", "Customer", "TroubleTicket", "Site"] as const;

export const searchFiltersSchema = z.object({
  q: z.string().max(200).optional(),
  types: z.array(z.string().max(64)).max(30).optional(),
  statuses: z.array(z.enum(STATUSES as [DocStatus, ...DocStatus[]])).max(7).optional(),
  sensitivity: z.array(z.enum(SENSITIVITIES)).max(4).optional(),
  entityTypes: z.array(z.string().max(64)).max(10).optional(),
  entityId: z.string().max(64).optional(),
  hold: z.boolean().optional(),
  review: z.boolean().optional(),
  changedAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  expiringBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(SORTS).optional(),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

/** Removes empty values so the same search always has the same cache key and URL. */
export function normaliseFilters(f: SearchFilters): SearchFilters {
  const out: SearchFilters = {};
  const q = f.q?.trim();
  if (q) out.q = q.slice(0, 200);
  if (f.types?.length) out.types = [...new Set(f.types)].sort();
  if (f.statuses?.length) out.statuses = [...new Set(f.statuses)].sort();
  if (f.sensitivity?.length) out.sensitivity = [...new Set(f.sensitivity)].sort();
  if (f.entityTypes?.length) out.entityTypes = [...new Set(f.entityTypes)].sort();
  if (f.entityId) out.entityId = f.entityId;
  if (f.hold) out.hold = true;
  if (f.review) out.review = true;
  if (f.changedAfter) out.changedAfter = f.changedAfter;
  if (f.expiringBefore) out.expiringBefore = f.expiringBefore;
  if (f.sort && f.sort !== "updated") out.sort = f.sort;
  return out;
}

export function hasAnyFilter(f: SearchFilters): boolean {
  const n = normaliseFilters(f);
  return Object.keys(n).some((k) => k !== "sort");
}

export interface Cursor {
  v: string;
  id: string;
}

export interface CursorRow {
  id: string;
  name: string;
  updated_at: string;
  expiry_date: string | null;
}

/** Keyset cursor from the last row of a page, matching the database sort. */
export function cursorFor(sort: SortKey, row: CursorRow): Cursor {
  if (sort === "name") return { v: row.name, id: row.id };
  if (sort === "expiry") return { v: row.expiry_date ?? "", id: row.id };
  return { v: row.updated_at, id: row.id };
}

/** We ask for one more row than shown; its presence means there is a next page. */
export function splitPage<T extends CursorRow>(rows: T[], sort: SortKey, size = PAGE_SIZE): { items: T[]; next: Cursor | null } {
  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  return { items, next: rows.length > size && last ? cursorFor(sort, last) : null };
}

/** "13 documents", "1 document", "More than 10,000 documents". */
export function countLabel(n: number): string {
  if (n > COUNT_CAP) return `More than ${COUNT_CAP.toLocaleString("en-GB")} documents`;
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "document" : "documents"}`;
}

/** Looks like an order, quote, contract or ticket number rather than words. */
export function looksLikeIdentifier(q: string): boolean {
  const t = q.trim();
  return t.length >= 3 && t.length <= 64 && !/\s/.test(t) && /\d/.test(t) && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(t);
}

// ---------- bulk ----------

export const BULK_ACTIONS = ["placeHold", "releaseHold", "setSensitivity", "transition"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export type SkipReason = "noPermission" | "frozen" | "notAllowed" | "detailsPending" | "notFound" | "unchanged";

export const SKIP_LABEL: Record<SkipReason, string> = {
  noPermission: "your role can't make this change",
  frozen: "the document can no longer be changed",
  notAllowed: "it isn't the next step on its status path",
  detailsPending: "required details still need checking",
  notFound: "it was removed or is no longer visible",
  unchanged: "it already had this value",
};

export interface BulkDocFacts {
  status: DocStatus;
  legalHold: boolean;
  sensitivity: string;
  pendingRequired: number;
}

export interface BulkParams {
  to?: DocStatus;
  sensitivity?: string;
}

/** Same role and status rules as the single-document actions. Null means the change can go ahead. */
export function bulkSkipReason(role: AppRole, action: BulkAction, params: BulkParams, d: BulkDocFacts | null): SkipReason | null {
  if (!d) return "notFound";
  if (action === "placeHold" || action === "releaseHold") {
    if (!can(role, "manage")) return "noPermission";
    if (d.legalHold === (action === "placeHold")) return "unchanged";
    return null;
  }
  if (action === "setSensitivity") {
    if (!can(role, "edit")) return "noPermission";
    if (isFrozen(d.status)) return "frozen";
    if (d.sensitivity === params.sensitivity) return "unchanged";
    return null;
  }
  const to = params.to;
  if (!to) return "notAllowed";
  if (!can(role, transitionCapability(to))) return "noPermission";
  if (d.status === to) return "unchanged";
  if (!isTransitionAllowed(d.status, to)) return "notAllowed";
  if (to === "approved" && d.pendingRequired > 0) return "detailsPending";
  return null;
}

export function bulkSummary(total: number, changed: number, skipped: Partial<Record<SkipReason, number>>): string {
  const parts = (Object.entries(skipped) as [SkipReason, number][])
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n.toLocaleString("en-GB")} skipped because ${SKIP_LABEL[r]}`);
  return [`${changed.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} changed`, ...parts].join(" · ");
}
