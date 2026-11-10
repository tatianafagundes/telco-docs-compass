// Pure rules for checking details read from a document (prompt 07) and explaining access (prompt 08).
import type { TagTone } from "@/components/erad/tag";
import { pendingRequiredDetails, type SpecCharacteristic } from "@/services/document-rules";

export type FieldStatus = "pending" | "accepted" | "edited" | "rejected";
export type Band = "high" | "medium" | "low";

export interface ReviewField {
  id: string;
  name: string;
  value: unknown;
  original_value: unknown;
  confidence: number | null;
  band: Band | null;
  status: FieldStatus;
  source: { page?: number; excerpt?: string; box?: { x: number; y: number; w: number; h: number } } | null;
}

export const FIELD_LABEL: Record<string, string> = {
  contractNumber: "Contract number",
  counterparty: "Other party",
  endDate: "End date",
  renewalType: "Renewal",
  renewalTermMonths: "Renewal term (months)",
  quoteNumber: "Quote number",
  vatNumber: "VAT number",
  validUntil: "Valid until",
};

/** Human label; unknown codes become "Sentence case" words, never the raw code. */
export function fieldLabel(code: string): string {
  if (FIELD_LABEL[code]) return FIELD_LABEL[code];
  const words = code.replace(/([A-Z])/g, " $1").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const BAND_TAG: Record<Band, { label: string; tone: TagTone }> = {
  high: { label: "High confidence", tone: "cleared" },
  medium: { label: "Medium confidence", tone: "indeterminate" },
  low: { label: "Low confidence", tone: "major" },
};

export const STATUS_WORD: Record<FieldStatus, string> = {
  pending: "Not checked yet",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
};

const BAND_RANK: Record<Band, number> = { low: 0, medium: 1, high: 2 };

/** Risk first: Low, Medium, High; unknown confidence goes first too. */
export function reviewOrder<T extends Pick<ReviewField, "band" | "name">>(fields: T[]): T[] {
  return [...fields].sort((a, b) => (a.band ? BAND_RANK[a.band] : -1) - (b.band ? BAND_RANK[b.band] : -1) || a.name.localeCompare(b.name));
}

export function toCheckCount(fields: Pick<ReviewField, "status">[]): number {
  return fields.filter((f) => f.status === "pending").length;
}

/** Index of the next unchecked field after `from`, wrapping round; -1 when all are checked. */
export function nextToCheck(fields: Pick<ReviewField, "status">[], from: number, step: 1 | -1 = 1): number {
  const n = fields.length;
  for (let i = 1; i <= n; i++) {
    const j = (((from + step * i) % n) + n) % n;
    if (fields[j]?.status === "pending") return j;
  }
  return -1;
}

export interface ApproveGate {
  pending: number;
  reason?: string;
}

/** Approve waits until every required readable detail is accepted or edited. */
export function approveGate(spec: SpecCharacteristic[], fields: Pick<ReviewField, "name" | "status">[]): ApproveGate {
  const pending = pendingRequiredDetails(spec, fields).length;
  if (pending === 0) return { pending };
  return { pending, reason: pending === 1 ? "1 required detail needs checking" : `${pending} required details need checking` };
}

export function bannerText(n: number): string {
  return n === 1 ? "1 detail read from this document needs checking." : `${n} details read from this document need checking.`;
}

export function editedNote(f: Pick<ReviewField, "status" | "band" | "original_value">): string | null {
  if (f.status !== "edited" || !f.band) return null;
  const word = f.band.charAt(0).toUpperCase() + f.band.slice(1);
  return `Edited – read as ${word}: ${String(f.original_value ?? "")}`;
}

// ---------- access explanation ----------
export interface AccessItem {
  subject: { type: "user" | "tenant"; id: string; displayName?: string | undefined };
  level: string;
  source: "inheritedFromEntity" | "explicit" | "crossTenantGrant";
  viaEntity?: { id: string; referredType?: string | undefined };
  grantedBy?: string | undefined;
  expiresAt?: string | undefined;
}

export function isExpired(expiresAt: string | undefined, now: Date): boolean {
  return Boolean(expiresAt && new Date(expiresAt) < now);
}

/** "You can see this because …" for the signed-in person. */
export function whyCanISee(
  items: AccessItem[],
  userId: string,
  entityName: (id: string) => string,
  formatDate: (iso: string) => string,
  now: Date,
): string {
  const mine = items.filter((i) => i.subject.type === "user" && i.subject.id === userId && !isExpired(i.expiresAt, now));
  const viaRecord = mine.find((i) => i.source === "inheritedFromEntity" && i.viaEntity);
  if (viaRecord?.viaEntity) return `You can see this because you can ${viaRecord.level === "edit" ? "edit" : "view"} ${entityName(viaRecord.viaEntity.id)}.`;
  const shared = mine.find((i) => i.source === "explicit");
  if (shared) {
    const who = shared.grantedBy ?? "someone in your organisation";
    return shared.expiresAt
      ? `You can see this because ${who} shared it with you until ${formatDate(shared.expiresAt)}.`
      : `You can see this because ${who} shared it with you.`;
  }
  return "You can see this because your role covers every record in your organisation.";
}

export const PAGE_SIZE = 20;
export function pageOf<T>(list: T[], page: number): T[] {
  return list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
}
