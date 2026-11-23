// File hooks: text that came from an outside system and may be shown to people. Pure: no I/O.

/**
 * Characters never accepted in text from an outside system: C0/C1 controls, lone surrogates (jsonb
 * refuses them), line and paragraph separators, bidi marks, embeddings, overrides and isolates,
 * invisible spaces and joiners that hide content (zero-width space, word joiner, byte-order mark) and
 * tag characters. Zero-width joiner and non-joiner stay allowed: scripts and emoji need them.
 */
export const UNSAFE_TEXT =
  /[\p{Cc}\p{Cs}\u061C\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;
const UNSAFE_ALL = new RegExp(UNSAFE_TEXT.source, "gu");

export function codePoints(s: string): number {
  return [...s].length;
}
/** The first `max` code points; never cuts a character in half. */
export function codePointSlice(s: string, max: number): string {
  const cps = [...s];
  return cps.length <= max ? s : cps.slice(0, max).join("");
}
/** A name to show (a system name, an unknown field name): unsafe characters replaced, then shortened. */
export function cleanLabel(s: string, max: number): string {
  const clean = s.replace(UNSAFE_ALL, "\uFFFD");
  return codePoints(clean) <= max ? clean : `${codePointSlice(clean, max - 1)}…`;
}
