import { fieldLabel } from "@/services/review-rules";
import type { TagTone } from "@/components/erad/tag";
import type { DocStatus, PipelineState } from "@/schemas/document";

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  effective: "Effective",
  superseded: "Superseded",
  expired: "Expired",
  archived: "Archived",
};

export const STATUS_TONE: Record<DocStatus, TagTone> = {
  draft: "indeterminate",
  in_review: "warning",
  approved: "cleared",
  effective: "cleared",
  superseded: "indeterminate",
  expired: "minor",
  archived: "indeterminate",
};

export const PIPELINE_LABEL: Record<PipelineState, string> = {
  uploading: "Uploading",
  scanning: "Checking for threats",
  reading: "Reading details",
  ready: "Ready",
  failed: "Couldn't read",
  quarantined: "Blocked for safety",
};

export const PIPELINE_TONE: Record<PipelineState, TagTone> = {
  uploading: "indeterminate",
  scanning: "indeterminate",
  reading: "purple",
  ready: "cleared",
  failed: "major",
  quarantined: "critical",
};

const ACTIVITY: Record<string, string> = {
  upload: "Uploaded",
  extractionReview: "Detail checked",
  view: "Viewed",
  download: "Downloaded",
  statusChange: "Status changed",
  hold: "Legal hold",
  delete: "Deleted",
  restore: "Restored",
  report: "Problem reported",
  share: "Shared",
  revoke: "Access removed",
  metadataChange: "Details edited",
  pipelineStateChange: "Processing updated",
  accessDenied: "Access refused",
  configChange: "Setting changed",
  purge: "Deleted permanently",
};

export function activityLabel(action: string): string {
  return ACTIVITY[action] ?? action;
}

/** Friendly message for a failed action; never the raw code. */
export function friendlyError(code: string | undefined): string {
  switch (code) {
    case "access.roleTooLow":
      return "Your role doesn't allow this action.";
    case "doc.transition.notAllowed":
      return "This step isn't available for the document right now. The page has been refreshed.";
    case "doc.approve.ownDocument":
      return "Someone other than the person who added it needs to approve it.";
    case "doc.approve.requiredPending":
      return "A few required details still need confirming before approval.";
    case "doc.delete.legalHold":
      return "A legal hold keeps this document safe, so it can't be deleted.";
    case "doc.delete.retention":
      return "This document is still within its keep-until period.";
    case "doc.edit.approvedContent":
      return "This document is approved, so its content stays as it was approved. You can still rename it or update its description.";
    case "doc.edit.frozen":
      return "This document is closed, so its details are kept as they are.";
    case "config.locked":
      return "This setting is locked by the group.";
    case "config.extendOnly":
      return "You can add to this type, but its group settings stay as they are.";
    case "config.belowFloor":
      return "That retention is shorter than the group minimum.";
    case "doc.notFound":
      return "This document is no longer available to you.";
    default:
      return "That didn't go through. You can try again in a moment.";
  }
}

/** Replaces status codes in an activity note with their labels ("draft to in_review" -> "Draft to In review"). */
export function activityDetail(detail: string): string {
  return detail
    .replace(/^granted (view|edit|manage) to user$/, (_m, l: string) => `access given (${l === "view" ? "can view" : l === "edit" ? "can edit" : "can manage"})`)
    .replace(/^revoked user$/, "access removed")
    .replace(/^granted (view|edit|manage) to tenant$/, "shared with another organisation")
    .replace(/^revoked tenant$/, "sharing with another organisation ended")
    .replace(/^Field (\w+)/, (_m, code: string) => `Field ${fieldLabel(code)}`)
    .replace(/\b(draft|in_review|approved|effective|superseded|expired|archived)\b/g, (m) => STATUS_LABEL[m as DocStatus]);
}

const TYPE_LABEL: Record<string, string> = {
  contract: "Contract", quote: "Quote", orderAttachment: "Order attachment", kycOutcome: "KYC outcome",
  bill: "Bill copy", technicalDoc: "Technical document", siteSurvey: "Site survey",
};

/** Plain name for a document type code ("orderAttachment" -> "Order attachment"). */
export function typeLabel(code: string): string {
  return TYPE_LABEL[code] ?? code.replace(/([a-z])([A-Z])/g, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}`).replace(/^./, (c) => c.toUpperCase());
}
