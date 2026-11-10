// Pure rules for the guided "Check details → Approve → Effective" journey.
import type { DocStatus } from "@/schemas/document";
import { nextStep } from "@/services/document-actions";
import { can, type AppRole, type SpecCharacteristic } from "@/services/document-rules";
import type { ApproveGate, Band, ReviewField } from "@/services/review-rules";

export const JOURNEY_STEPS = ["Check details", "Approve", "Effective"] as const;

/** 0 = check details, 1 = approve, 2 = make effective, 3 = done; null when the journey doesn't apply. */
export function journeyStep(status: DocStatus, toCheck: number): 0 | 1 | 2 | 3 | null {
  if (status === "draft" || status === "in_review") return toCheck > 0 ? 0 : 1;
  if (status === "approved") return 2;
  if (status === "effective") return 3;
  return null;
}

/** Four-eyes: the person who added a document can't approve it. */
export const AUTHOR_APPROVE_REASON = "Someone other than the person who added it needs to approve it.";
export function isOwnDocument(createdBy: string | null | undefined, userId: string): boolean {
  return Boolean(createdBy) && createdBy === userId;
}

export type FooterAction =
  | { kind: "next"; label: string }
  | { kind: "transition"; to: DocStatus; label: string; available: boolean; reason?: string }
  | { kind: "done"; label: string };

export function footerAction(input: { role: AppRole; status: DocStatus; toCheck: number; gate: ApproveGate; own: boolean }): FooterAction {
  const { role, status, toCheck, gate, own } = input;
  if (toCheck > 0 && can(role, "review")) return { kind: "next", label: "Next detail" };
  const step = nextStep(role, status);
  if (status === "draft" && step) return { kind: "transition", to: step.to, label: "Send for approval", available: step.available, ...(step.reason ? { reason: step.reason } : {}) };
  if (status === "in_review" && step) {
    if (!step.available) return { kind: "transition", to: step.to, label: "Approve document", available: false, ...(step.reason ? { reason: step.reason } : {}) };
    if (gate.reason) return { kind: "transition", to: step.to, label: "Approve document", available: false, reason: gate.reason };
    if (own) return { kind: "transition", to: step.to, label: "Approve document", available: false, reason: AUTHOR_APPROVE_REASON };
    return { kind: "transition", to: step.to, label: "Approve document", available: true };
  }
  return { kind: "done", label: "Back to document" };
}

export function outcomeSummary(fields: Pick<ReviewField, "status">[]): string {
  const n = (s: string) => fields.filter((f) => f.status === s).length;
  const parts = [
    n("accepted") ? `${n("accepted")} confirmed` : "",
    n("edited") ? `${n("edited")} corrected` : "",
    n("rejected") ? `${n("rejected")} not in the document` : "",
  ].filter(Boolean);
  return parts.length ? `All details checked: ${parts.join(", ")}.` : "All details checked.";
}

// ---------- telecom checks ----------

export type MatchResult = "matches" | "differs" | null;
const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Identifiers that should agree with the record the document belongs to (CPQ quote, Order care order, contract). */
const RECORD_KEYS = new Set(["quoteNumber", "orderNumber", "contractNumber"]);

/**
 * Compares an identifier read from the document with the record's own name and id.
 * Only says "matches" or "differs" and never returns the record's values.
 */
export function recordMatch(fieldName: string, value: unknown, record: { id: string; displayName: string } | null): MatchResult {
  if (!record || !RECORD_KEYS.has(fieldName) || value === null || value === undefined || String(value).trim() === "") return null;
  const v = norm(String(value));
  if (v.length < 4) return null;
  const hay = [norm(record.displayName), norm(record.id)];
  return hay.some((h) => h.includes(v)) ? "matches" : "differs";
}

export type FormatResult = { ok: true } | { ok: false; hint: string } | null;

/** Swedish, Norwegian and EU-style VAT numbers, plus dates. */
export function formatCheck(fieldName: string, value: unknown): FormatResult {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const v = String(value).trim();
  if (fieldName === "vatNumber") {
    const c = v.toUpperCase().replace(/[\s.-]/g, "");
    if (c.startsWith("SE")) return /^SE\d{10}01$/.test(c) ? { ok: true } : { ok: false, hint: "A Swedish VAT number is SE, 10 digits, then 01." };
    if (c.startsWith("NO")) return /^NO\d{9}MVA$/.test(c) ? { ok: true } : { ok: false, hint: "A Norwegian VAT number is NO, 9 digits, then MVA." };
    return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(c) ? { ok: true } : { ok: false, hint: "A VAT number starts with a two-letter country code." };
  }
  if (/(Date|Until)$/.test(fieldName)) {
    return Number.isNaN(Date.parse(v)) ? { ok: false, hint: "This doesn't read as a date." } : { ok: true };
  }
  return null;
}

/** Plain reason behind the confidence, telecom checks first. */
export function confidenceReason(band: Band | null, match: MatchResult, format: FormatResult): string {
  if (match === "differs") return "Differs from the record. Compare with the page.";
  if (format && !format.ok) return format.hint;
  if (match === "matches") return "Matches the record.";
  if (band === "low") return "Hard to read. Compare with the page.";
  if (band === "medium") return "Partly clear. Worth a quick look.";
  if (band === "high") return "Clearly read.";
  return "No score. Compare with the page.";
}

/** Required details are contract-critical: approval waits for them. */
export function isContractCritical(spec: SpecCharacteristic[], fieldName: string): boolean {
  return spec.some((c) => c.name === fieldName && c.required === true);
}

/** Order details as they appear on the page: page, then top to bottom. */
export function pageOrder<T extends Pick<ReviewField, "source" | "name">>(fields: T[]): T[] {
  return [...fields].sort(
    (a, b) => (a.source?.page ?? 1) - (b.source?.page ?? 1) || (a.source?.box?.y ?? 0) - (b.source?.box?.y ?? 0) || a.name.localeCompare(b.name),
  );
}

const RISK: Record<Band, number> = { low: 0, medium: 1, high: 2 };

/** Index of the unchecked detail to look at next: contract-critical first, then least certain, then page order. */
export function mostUrgent(fields: Pick<ReviewField, "status" | "band" | "name">[], critical: (name: string) => boolean, flagged: (name: string) => boolean = () => false): number {
  let best = -1;
  let bestKey = Infinity;
  fields.forEach((f, i) => {
    if (f.status !== "pending") return;
    const key = (critical(f.name) ? 0 : 100) + (flagged(f.name) ? 0 : 10) + (f.band ? RISK[f.band] : -1) + i / 1000;
    if (key < bestKey) { bestKey = key; best = i; }
  });
  return best;
}
