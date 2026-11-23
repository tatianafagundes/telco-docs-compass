// Pure view rules: which actions a person sees for a document, and why one is unavailable.
import type { DocStatus } from "@/schemas/document";
import {
  addDocumentsBlocker,
  can,
  shareCappedRole,
  type ShareLevel,
  contentProtected,
  retentionHolds,
  isFrozen,
  transitionCapability,
  type AppRole,
} from "@/services/document-rules";

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
  draft: { to: "in_review", label: "Send for approval" },
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

/**
 * True when an action is unavailable only because of the person's role. Nothing they can do on
 * this document changes that, so the screens hide the action instead of showing it disabled (R21).
 * Reasons tied to the document (a hold, a keep-until date, details to check, four-eyes) stay shown.
 */
export function blockedByRole(state: { available: boolean; reason?: string | undefined }): boolean {
  return (
    !state.available &&
    (Object.values(ROLE_REASON).includes(state.reason ?? "") ||
      state.reason === "Only administrators can delete permanently.")
  );
}

export function nextStep(role: AppRole, status: DocStatus): NextStep | null {
  const n = NEXT[status];
  if (!n) return null;
  const cap = transitionCapability(n.to);
  return can(role, cap)
    ? { ...n, available: true }
    : { ...n, available: false, reason: ROLE_REASON[cap] };
}

export function editState(role: AppRole, status: DocStatus): ActionState {
  if (!can(role, "edit")) return { available: false, reason: ROLE_REASON.edit };
  if (isFrozen(status))
    return {
      available: false,
      reason: "This document is closed, so its details are kept as they are.",
    };
  return { available: true };
}

export const APPROVED_CONTENT_REASON =
  "This document is approved, so its content stays as it was approved. You can still rename it or update its description.";

/** Content (file, confirmed details, dates) can change only before approval. */
export function contentEditState(role: AppRole, status: DocStatus): ActionState {
  const base = editState(role, status);
  if (!base.available) return base;
  if (contentProtected(status)) return { available: false, reason: APPROVED_CONTENT_REASON };
  return { available: true };
}

export function sendBackState(role: AppRole, status: DocStatus): ActionState | null {
  if (status !== "in_review") return null;
  return can(role, "review")
    ? { available: true }
    : { available: false, reason: ROLE_REASON.review };
}

export function manageState(role: AppRole): ActionState {
  return can(role, "manage")
    ? { available: true }
    : { available: false, reason: ROLE_REASON.manage };
}

/** "Add documents" on the record page and the Documents page; the server applies the same rule. */
export function addDocumentsState(role: AppRole): ActionState {
  const blocked = addDocumentsBlocker(role);
  if (!blocked) return { available: true };
  return {
    available: false,
    reason:
      blocked.code === "access.groupAdminNoDocuments"
        ? "The group administrator works with settings and counts, not documents."
        : "Viewers can open documents here but can't add them.",
  };
}
/** "Delete permanently": admins only, no hold, and past the keep-until date. */
export function purgeState(
  role: AppRole,
  legalHold: boolean,
  retainUntil: string | null,
  today: string,
): ActionState {
  if (role !== "tenant_admin" && role !== "master_admin")
    return { available: false, reason: "Only administrators can delete permanently." };
  if (legalHold)
    return {
      available: false,
      reason: "A legal hold blocks permanent deletion. Release the hold first.",
    };
  if (retentionHolds(retainUntil, today))
    return { available: false, reason: `This document must be kept until ${retainUntil}.` };
  return { available: true };
}

/** The error a refused permanent delete reports: who you are first, then a hold, then the keep-until date. */
export function purgeRefusalCode(role: AppRole, legalHold: boolean): string {
  if (role !== "tenant_admin" && role !== "master_admin") return "access.roleTooLow";
  return legalHold ? "doc.delete.legalHold" : "doc.delete.retention";
}

export function deleteState(
  role: AppRole,
  legalHold: boolean,
  retainUntil: string | null,
  today: string,
): ActionState {
  const m = manageState(role);
  if (!m.available) return m;
  if (legalHold)
    return {
      available: false,
      reason: "A legal hold keeps this document safe. Release the hold first.",
    };
  if (retentionHolds(retainUntil, today))
    return { available: false, reason: `This document must be kept until ${retainUntil}.` };
  return { available: true };
}

/**
 * Role used when a person reaches a document only through a direct share.
 * A "view" share caps them at viewer; an "edit" share caps them at contributor.
 * Record-scoped work (reviewing, approving, managing access) needs record access.
 */
export function sharedOnlyRole(role: AppRole, level: ShareLevel): AppRole {
  return shareCappedRole(role, level);
}

/** Record page summary: which documents count as the current approved version. List order is kept (newest first). */
export function approvedSummary<T extends { status: DocStatus }>(items: T[], max = 3) {
  const approved = items.filter((d) => d.status === "approved" || d.status === "effective");
  const inReview = items.filter((d) => d.status === "in_review");
  return { shown: approved.slice(0, max), more: Math.max(0, approved.length - max), inReview };
}
