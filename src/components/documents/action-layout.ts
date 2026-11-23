import { nextStep, sendBackState, type NextStep } from "@/services/document-actions";
import type { AppRole } from "@/services/document-rules";
import type { DocStatus } from "@/schemas/document";
import { AUTHOR_APPROVE_REASON } from "@/services/review-flow-rules";
export interface ActionLayout {
  /**
   * The one primary action. "check" while a required detail blocks Approve: checking is then
   * the way forward. "next" for the next status step. null when there is no step to take.
   */
  primary: "check" | "next" | null;
  /** The next status step, with why it is unavailable when it is. */
  next: (NextStep & { reason?: string | undefined }) | null;
  /** Send back lives in "More actions"; null when it does not apply to this status. */
  sendBack: { reason?: string | undefined } | null;
}
export function actionLayout(
  role: AppRole,
  status: DocStatus,
  gateReason: string | null | undefined,
  own: boolean,
): ActionLayout {
  const step = nextStep(role, status);
  const approving = step?.to === "approved" && step.available;
  const gated = !!(approving && gateReason);
  const authorBlocked = !!(approving && !gated && own);
  const next = !step
    ? null
    : gated
      ? { ...step, available: false, reason: gateReason ?? undefined }
      : authorBlocked
        ? { ...step, available: false, reason: AUTHOR_APPROVE_REASON }
        : step;
  const back = sendBackState(role, status);
  return {
    primary: gated ? "check" : next ? "next" : null,
    next,
    sendBack: back ? (back.available ? {} : { reason: back.reason }) : null,
  };
}

/** The line under "Check details": what it unlocks, in one plain sentence. */
export function gateHint(nextLabel: string, pending: number): string {
  const what = pending === 1 ? "1 required detail" : `${pending} required details`;
  return `${nextLabel} is available after you check ${what}.`;
}
