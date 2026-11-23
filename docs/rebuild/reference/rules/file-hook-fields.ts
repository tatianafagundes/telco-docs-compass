// File hooks: what an antivirus or a reader may send back (R2.2, R2.6, R3.2, R3.3), checked as a whole
// before anything is written. Pure: no I/O.
import { z } from "zod";
import type { Band } from "@/services/review-rules";
import { cleanLabel, codePoints, UNSAFE_TEXT } from "@/services/file-hook-text";

export const MAX_EXTRACTED_FIELDS = 100;
/** Longest text value from a reader, in code points (a person still checks every one). */
export const MAX_EXTRACTED_VALUE_CHARS = 2000;
/** Longest `engine`, `threatName` or field `source` label. */
export const MAX_LABEL_CHARS = 64;
/** Longest field name a reader may send, in code points (names must match the type's details anyway). */
export const MAX_FIELD_NAME_CHARS = 200;
/** Confidence at or above this (as a percentage) is High, unless the detail asks for more. */
export const HIGH_CONFIDENCE_PERCENT = 90;
/** Confidence at or above this (as a percentage) is Medium; below it, Low. */
export const MEDIUM_CONFIDENCE_PERCENT = 70;

const LABEL = new RegExp(`^[A-Za-z0-9 ._:/-]{1,${MAX_LABEL_CHARS}}$`);
const SOURCE = new RegExp(`^[\\w .:/-]{0,${MAX_LABEL_CHARS}}$`);
const attempt = z.number().int().min(1).max(999_999_999);
const hash = z.string().regex(/^[A-Za-z0-9:+/=_-]{1,200}$/);

/** Body of `POST …/scanResult`. Unknown keys are refused, so a typo is not silently ignored. */
export const scanResultSchema = z
  .object({
    result: z.enum(["clean", "infected", "error"]),
    contentHash: hash,
    attempt,
    engine: z.string().regex(LABEL),
    threatName: z.string().regex(LABEL).optional(),
  })
  .strict()
  .refine((b) => b.result === "infected" || b.threatName === undefined, {
    message: "threatName is only sent with an infected result",
    path: ["threatName"],
  });
export type ScanResultBody = z.infer<typeof scanResultSchema>;

const fieldShape = z
  .object({
    name: z
      .string()
      .min(1)
      .refine((n) => codePoints(n) <= MAX_FIELD_NAME_CHARS),
    value: z.unknown(),
    confidence: z.number().finite().min(0).max(1),
    // A plain label such as "page 2: table 1", never a link (R3.3).
    source: z
      .string()
      .regex(SOURCE)
      .refine((v) => !/:\/\/|^\/\/|^www\./i.test(v))
      .optional(),
  })
  .strict();
export type ExtractedField = z.infer<typeof fieldShape>;
/** Body of `POST …/extractionResult`. Fields come only with `read` (R3.5). */
export const extractionResultSchema = z.discriminatedUnion("result", [
  z
    .object({
      result: z.literal("read"),
      attempt,
      fields: z.array(fieldShape).max(MAX_EXTRACTED_FIELDS),
    })
    .strict(),
  z.object({ result: z.literal("unreadable"), attempt }).strict(),
]);
export type ExtractionResultBody = z.infer<typeof extractionResultSchema>;

/** A detail of the document's type, as stored in its specification. */
export interface FieldSpec {
  name: string;
  valueType?: string;
  enumValues?: string[];
  /** A stricter cut-off for High (0–1); it can only raise the default, never lower it. */
  reviewThreshold?: number;
}
export interface AcceptedField {
  name: string;
  value: string | number | boolean;
  confidence: number;
  band: Band;
  source: string | null;
}
export type FieldsCheck =
  | { ok: true; fields: AcceptedField[] }
  | {
      ok: false;
      code: "unknownFields" | "duplicateFields" | "badValues";
      /** Offending names, unsafe characters replaced and shortened; the caller still escapes them. */
      names: string[];
    };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAMES_SHOWN = 20;

function realDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const d = new Date(0);
  // setUTCFullYear keeps years 0-99 as they are (Date.UTC would read them as 1900-1999).
  d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}
function safeText(s: string): boolean {
  return codePoints(s) <= MAX_EXTRACTED_VALUE_CHARS && !UNSAFE_TEXT.test(s);
}
/** The value as stored, or undefined when it does not fit the detail's type. */
function typed(spec: FieldSpec, v: unknown): string | number | boolean | undefined {
  switch (spec.valueType ?? "string") {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    case "boolean":
      return typeof v === "boolean" ? v : undefined;
    case "date":
      return typeof v === "string" && realDate(v) ? v : undefined;
    case "enum":
      return typeof v === "string" && (spec.enumValues ?? []).includes(v) ? v : undefined;
    case "string":
      return typeof v === "string" && safeText(v) ? v : undefined;
    default:
      return undefined; // a type this rule does not know is never accepted
  }
}

/**
 * The confidence band of a detail from a reader. `reviewThreshold` (0–1) can only make High stricter;
 * a value above 1 (for example a percentage) is ignored and the default applies.
 */
export function bandFor(confidence: number, reviewThreshold?: number): Band {
  const high = Math.max(
    HIGH_CONFIDENCE_PERCENT / 100,
    typeof reviewThreshold === "number" && reviewThreshold <= 1 ? reviewThreshold : 0,
  );
  if (confidence >= high) return "high";
  return confidence >= MEDIUM_CONFIDENCE_PERCENT / 100 ? "medium" : "low";
}

/**
 * Checks a reader's fields against the document type as a whole: every name must be a detail of the
 * type (exact match), once, with a value of that detail's type. Nothing is accepted if anything is
 * wrong. Accepted fields are only proposals: a person still checks each one (R3.4, BR-023).
 */
export function checkExtractedFields(fields: ExtractedField[], spec: FieldSpec[]): FieldsCheck {
  const byName = new Map(spec.map((s) => [s.name, s]));
  const unknown = fields
    .filter((f) => !byName.has(f.name))
    .map((f) => cleanLabel(f.name, MAX_LABEL_CHARS));
  if (unknown.length)
    return { ok: false, code: "unknownFields", names: [...new Set(unknown)].slice(0, NAMES_SHOWN) };
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const f of fields) (seen.has(f.name) ? dup : seen).add(f.name);
  if (dup.size)
    return {
      ok: false,
      code: "duplicateFields",
      names: [...dup].map((n) => cleanLabel(n, MAX_LABEL_CHARS)).slice(0, NAMES_SHOWN),
    };
  const accepted: AcceptedField[] = [];
  const bad: string[] = [];
  for (const f of fields) {
    const s = byName.get(f.name)!;
    const value = typed(s, f.value);
    if (value === undefined) bad.push(f.name);
    else
      accepted.push({
        name: f.name,
        value,
        confidence: f.confidence,
        band: bandFor(f.confidence, s.reviewThreshold),
        source: f.source ? f.source : null,
      });
  }
  if (bad.length)
    return {
      ok: false,
      code: "badValues",
      names: bad.map((n) => cleanLabel(n, MAX_LABEL_CHARS)).slice(0, NAMES_SHOWN),
    };
  return { ok: true, fields: accepted };
}
