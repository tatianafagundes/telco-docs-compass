// File hooks: keys for the organisation's own antivirus (`scan`) and reader (`extract`). Such a key
// has that one scope and nothing else (D4), and one organisation has at most one active key of each
// (D3). Pure: no I/O. Spec: .kiro/specs/file-hooks (D3, D4, R6.2).
import type { Step } from "@/services/file-hook-detail";

export const PROCESSING_SCOPES = ["scan", "extract"] as const;
export type ProcessingScope = (typeof PROCESSING_SCOPES)[number];
export const STEP_SCOPE: Record<Step, ProcessingScope> = { scan: "scan", read: "extract" };

const isProcessing = (s: string): s is ProcessingScope =>
  (PROCESSING_SCOPES as readonly string[]).includes(s);

/** The processing scope of a key that has one, whatever else it lists. */
export function processingScope(scopes: readonly string[]): ProcessingScope | null {
  return scopes.find(isProcessing) ?? null;
}
/** A key with a processing scope must have exactly that one scope (D4). */
export function scopesAllowed(scopes: readonly string[]): boolean {
  const unique = new Set(scopes);
  return !processingScope([...unique]) || unique.size === 1;
}
/** Not revoked and not expired at `now`: the key can be used. */
export function isActiveKey(
  row: { revoked_at: string | null; expires_at: string | null },
  now: Date,
): boolean {
  return !row.revoked_at && !(row.expires_at && new Date(row.expires_at) <= now);
}
