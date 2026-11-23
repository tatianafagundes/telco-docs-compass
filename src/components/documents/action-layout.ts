import { blockedByRole, nextStep, sendBackState, type NextStep } from "@/services/document-actions";
import type { AppRole } from "@/services/document-rules";
import type { DocStatus, PipelineState } from "@/schemas/document";
import { fileBlocker } from "@/services/document-rules";
/** Why a step waits for the file, by where the file is. */
export const NO_FILE_REASON: Partial<Record<PipelineState, string>> = {
  uploading:
    "The file has not arrived yet. Add it with a new version, or wait for the system that sends it.",
  scanning: "The file is still being checked for viruses.",
  reading: "The file is still being read.",
  failed: "Reading the file failed. Retry, or keep it without reading.",
  quarantined: "The file was quarantined. Replace it with a new version.",
};
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
  pipelineState: PipelineState = "ready",
): ActionLayout {
  const raw = nextStep(role, status);
  // A step this role can never take is not shown at all (R21).
  const shown = raw && blockedByRole(raw) ? null : raw;
  // No checked file: the step waits for it, whatever else is pending (same rule as the server).
  const step =
    shown?.available && fileBlocker(shown.to, pipelineState)
      ? {
          ...shown,
          available: false,
          reason: NO_FILE_REASON[pipelineState] ?? "The file is not in yet.",
        }
      : shown;
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
    sendBack: back && !blockedByRole(back) ? (back.available ? {} : { reason: back.reason }) : null,
  };
}

/** The line under "Check details": what it unlocks, in one plain sentence. */
export function gateHint(nextLabel: string, pending: number): string {
  const what = pending === 1 ? "1 required detail" : `${pending} required details`;
  return `${nextLabel} is available after you check ${what}.`;
}
