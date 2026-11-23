// EDS UX writing: the same action has the same label everywhere. This guard reads the screen
// code and fails on labels EDS lists under "Don't use" (guidelines > UX writing > EDS terminology).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "integrations" ? [] : files(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}
// Text between tags or in a string literal: what a person reads.
const BANNED: [RegExp, string][] = [
  [/["'>`]\s*Sign (in|out)\b/, 'use "Log in" / "Log out"'],
  [
    /["'>`]\s*Log ?In\b|["'>`]\s*Login\b|["'>`]\s*Log ?Out\b|["'>`]\s*Logout\b/,
    'write "Log in" / "Log out" in sentence case',
  ],
];
describe("EDS terminology", () => {
  const all = files("src").map((p) => ({ p, text: readFileSync(p, "utf8") }));
  for (const [re, fix] of BANNED) {
    it(`no screen text matches ${re.source} (${fix})`, () => {
      expect(all.filter((f) => re.test(f.text)).map((f) => f.p)).toEqual([]);
    });
  }
});
