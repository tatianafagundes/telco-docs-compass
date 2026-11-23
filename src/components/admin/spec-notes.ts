import type { SettingSource } from "@/services/tenant-rules";
export interface FieldNote {
  source: SettingSource;
  reason: string | null;
}
export interface SectionNotes {
  /** Shown once beside the heading when every field shares it; otherwise null. */
  source: SettingSource | null;
  /** Shown once under the heading when every field shares it; otherwise null. */
  reason: string | null;
  /** What each field still shows on its own line. */
  perField: { source: SettingSource | null; reason: string | null }[];
}
/**
 * One note per section instead of the same tag and sentence under every field.
 * A tag or reason moves up to the section when all fields share it, and stays per field
 * only where fields differ.
 */
export function sectionNotes(fields: FieldNote[]): SectionNotes {
  const first = fields[0];
  const sameSource = !!first && fields.every((f) => f.source === first.source);
  const sameReason = !!first && fields.every((f) => f.reason === first.reason);
  return {
    source: sameSource ? first.source : null,
    reason: sameReason ? first.reason : null,
    perField: fields.map((f) => ({
      source: sameSource ? null : f.source,
      reason: sameReason ? null : f.reason,
    })),
  };
}
