// Pure view rules: which actions a person sees for a document, and why one is unavailable.
import type { DocStatus } from "@/schemas/document";
import { can, isFrozen, transitionCapability, type AppRole } from "@/services/document-rules";

export interface ActionState {
  available: boolean;
  /** Plain reason shown next to an unavailable action. */
  reason?: string;
}

export interface NextStep extends ActionState {
  to: DocStatus;
  label: string;
}

const NEXT: Partial<Record<DocStatus, { to: DocStatus; label: string }>> = {
  draft: { to: "in_review", label: "Send for review" },
  in_review: { to: "approved", label: "Approve" },
  approved: { to: "effective", label: "Make effective" },
  effective: { to: "superseded", label: "Mark as superseded" },
  superseded: { to: "archived", label: "Archive" },
  expired: { to: "archived", label: "Archive" },
};

const ROLE_REASON: Record<"edit" | "review" | "manage", string> = {
  edit: "Your role can view this document but not change it.",
  review: "Only reviewers and managers can do this.",
  manage: "Only managers and administrators can do this.",
};

export function nextStep(role: AppRole, status: DocStatus): NextStep | null {
  const n = NEXT[status];
  if (!n) return null;
  const cap = transitionCapability(n.to);
  return can(role, cap) ? { ...n, available: true } : { ...n, available: false, reason: ROLE_REASON[cap] };
}

export function editState(role: AppRole, status: DocStatus): ActionState {
  if (!can(role, "edit")) return { available: false, reason: ROLE_REASON.edit };
  if (isFrozen(status)) return { available: false, reason: "This document is closed, so its details are kept as they are." };
  return { available: true };
}

export function sendBackState(role: AppRole, status: DocStatus): ActionState | null {
  if (status !== "in_review") return null;
  return can(role, "review") ? { available: true } : { available: false, reason: ROLE_REASON.review };
}

export function manageState(role: AppRole): ActionState {
  return can(role, "manage") ? { available: true } : { available: false, reason: ROLE_REASON.manage };
}

/** "Delete permanently": admins only, no hold, and past the keep-until date. */
export function purgeState(role: AppRole, legalHold: boolean, retainUntil: string | null, today: string): ActionState {
  if (role !== "tenant_admin" && role !== "master_admin") return { available: false, reason: "Only administrators can delete permanently." };
  if (legalHold) return { available: false, reason: "A legal hold blocks permanent deletion. Release the hold first." };
  if (retainUntil && retainUntil >= today) return { available: false, reason: `This document must be kept until ${retainUntil}.` };
  return { available: true };
}

export function deleteState(role: AppRole, legalHold: boolean, retainUntil: string | null, today: string): ActionState {
  const m = manageState(role);
  if (!m.available) return m;
  if (legalHold) return { available: false, reason: "A legal hold keeps this document safe. Release the hold first." };
  if (retainUntil && retainUntil > today) return { available: false, reason: `This document must be kept until ${retainUntil}.` };
  return { available: true };
}

/**
 * Role used when a person reaches a document only through a direct share.
 * A "view" share caps them at viewer; an "edit" share caps them at contributor.
 * Record-scoped work (reviewing, approving, managing access) needs record access.
 */
export function sharedOnlyRole(role: AppRole, level: "view" | "edit" | "manage"): AppRole {
  if (level === "view") return "viewer";
  return can(role, "edit") ? "contributor" : "viewer";
}

/** Record page summary: which documents count as the current approved version. List order is kept (newest first). */
export function approvedSummary<T extends { status: DocStatus }>(items: T[], max = 3) {
  const approved = items.filter((d) => d.status === "approved" || d.status === "effective");
  const inReview = items.filter((d) => d.status === "in_review");
  return { shown: approved.slice(0, max), more: Math.max(0, approved.length - max), inReview };
}
