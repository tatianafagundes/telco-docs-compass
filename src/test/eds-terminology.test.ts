// EDS UX writing: the same action has the same label everywhere. This guard reads the screen
// code (.ts and .tsx, comments skipped) and fails on labels EDS lists under "Don't use"
// (guidelines > UX writing > EDS terminology). It reports the file and line.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory())
      return n === "__tests__" || n === "integrations" || n === "test" ? [] : files(p);
    return /\.tsx?$/.test(p) && !p.endsWith(".gen.ts") ? [p] : [];
  });
}
/** Lines a person may read: not comments. Kept simple on purpose. */
function textLines(source: string): { n: number; line: string }[] {
  return source
    .split("\n")
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\s*\/\*)/.test(line));
}
// A word inside a string, a template or JSX text: preceded by a quote, backtick, ">", "}" or a space.
export const BANNED: [RegExp, string][] = [
  [/(^|["'`>}\s])sign[ \u00a0]?(in|out)\b/i, 'use "Log in" / "Log out"'],
  [/(^|["'`>}\s])(Log In|Login|Log Out|Logout|Log Off)\b/, 'write "Log in" / "Log out"'],
  [/(^|["'`>}\s])Clear (filters|all|selection)\b/i, 'use "Clear"'],
  [/(^|["'`>}\s])Add (a |new )(\w+ )?type\b/i, 'use "Create" for a new entity'],
  [/["'`>]\s*(Submit|Continue|Proceed)\b/, 'use "Finish" or "Next"'],
];
// Identifiers that only look like banned words.
const ALLOWED = [
  /signInWithPassword/,
  /signOut\(/,
  /\bsignIn\b/,
  /LogIn\b.*from "lucide-react"/,
  /LogOut\b/,
];
describe("EDS terminology", () => {
  const all = files("src").flatMap((p) =>
    textLines(readFileSync(p, "utf8")).map((l) => ({ where: `${p}:${l.n}`, line: l.line })),
  );
  for (const [re, fix] of BANNED) {
    it(`no screen text matches ${re.source} (${fix})`, () => {
      const hits = all.filter(
        ({ line }) =>
          re.test(line) && !ALLOWED.some((a) => a.test(line) && !re.test(line.replace(a, ""))),
      );
      expect(hits.map((h) => `${h.where}: ${h.line.trim()}`)).toEqual([]);
    });
  }
  it("catches the cases people actually write", () => {
    const caught = [
      "<a>{x} Sign in</a>",
      "`Hi ${n}, Sign In`",
      'aria-label="Please sign in"',
      '"Clear all filters"',
      '"Add a document type"',
      ">Submit<",
    ];
    for (const s of caught)
      expect(
        BANNED.some(([re]) => re.test(s)),
        s,
      ).toBe(true);
    for (const s of ['"Log in"', '"Clear"', '"Create document type"', '"Signed by the customer"'])
      expect(
        BANNED.some(([re]) => re.test(s)),
        s,
      ).toBe(false);
  });
});
