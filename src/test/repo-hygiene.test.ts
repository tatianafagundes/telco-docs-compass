// Repository hygiene, checked inside `bun run check` (there is no CI, so this is the guard).
// Rules are explained in AGENTS.md > "Repository rules".
//
// 1. Size: no code file in src/services is longer than 300 lines, except the ones listed in
//    OVERSIZED, which may not grow and must leave the list once they are split.
// 2. Docs: a link or a `path/in/backticks` in the docs we maintain must point at a file that exists.
// 3. Module READMEs: every README.md under src/services has the same seven sections.
// 4. English only: no Portuguese in the code and docs we maintain.
// 5. The rebuild handbook (docs/rebuild) carries copies of contracts, migrations, rules and tests so it can
//    be handed over as one folder. They must match their sources: `bun run sync:rebuild` refreshes them.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

// Run vitest from the repository root (`bun run test` does). The jsdom environment does not give
// import.meta.url a file path, so the working directory is the root.
const ROOT = process.cwd();
if (!existsSync(join(ROOT, "package.json"))) {
  throw new Error(`repo-hygiene must run from the repository root, not from ${ROOT}`);
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const exists = (p: string) => existsSync(join(ROOT, p));
const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".output",
  ".worktrees",
  ".wrangler",
]);

/** All files under `dir` that `keep` accepts. Symlinks are not followed. A missing `dir` gives []. */
function walk(dir: string, keep: (path: string) => boolean): string[] {
  if (!exists(dir)) return [];
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    if (SKIPPED_DIRS.has(entry.name) || lstatSync(join(ROOT, rel)).isSymbolicLink()) return [];
    return entry.isDirectory() ? walk(rel, keep) : keep(rel) ? [rel] : [];
  });
}

/** Same count as `wc -l`: a trailing newline does not add a line. */
function lineCount(path: string): number {
  const text = read(path);
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

// ---------- 1. size ----------
const MAX_LINES = 300;
/** Files above the limit today, with the length they may not exceed. Split or shrink, then delete the entry. */
const OVERSIZED: Record<string, number> = {};
const codeFiles = walk(
  "src/services",
  (p) => /\.(ts|tsx|js|jsx)$/.test(p) && !p.includes("__tests__"),
);

describe(`files in src/services stay within ${MAX_LINES} lines`, () => {
  it("no file is longer than the limit, or than its listed length", () => {
    const tooLong = codeFiles
      .map((f) => ({ f, n: lineCount(f), max: OVERSIZED[f] ?? MAX_LINES }))
      .filter(({ n, max }) => n > max)
      .map(({ f, n, max }) => `${f}: ${n} lines (limit ${max})`);
    expect(
      tooLong,
      `Files in src/services must stay at ${MAX_LINES} lines or fewer, and the files listed in OVERSIZED ` +
        "(src/test/repo-hygiene.test.ts) may not grow. Move the new code into a new file next to " +
        "the one you edited. Do not raise the number. See AGENTS.md > Repository rules. Over the limit:",
    ).toEqual([]);
  });

  it("the list of exceptions only holds files that are still over the limit", () => {
    const stale = Object.keys(OVERSIZED).filter((f) => !exists(f) || lineCount(f) <= MAX_LINES);
    expect(
      stale,
      "These files are now within the limit (or gone). Delete their entries from OVERSIZED:",
    ).toEqual([]);
  });
});

// ---------- 2. docs point at real files ----------
/** Docs that must exist: if one is renamed, the check must not quietly stop covering it. */
const REQUIRED_DOCS = [
  "README.md",
  "AGENTS.md",
  "docs/development.md",
  "src/routes/api/public/tmf-api/AGENTS.md",
];
const DOCS = [
  ...REQUIRED_DOCS,
  "roadmap.md",
  ...walk("docs/architecture", (p) => p.endsWith(".md")),
  ...walk("docs/operations", (p) => p.endsWith(".md")),
  ...walk(".kiro/steering", (p) => p.endsWith(".md")),
  ...walk("src", (p) => p.endsWith("README.md")),
];
const PATH_PREFIXES = "src|docs|contracts|e2e|drizzle|scripts|public|\\.kiro";

/** Named in the docs on purpose to say "do not create this", so they must NOT exist. */
const FORBIDDEN_ON_PURPOSE = new Set(["src/pages/", "src/routes/_app/index.tsx"]);

interface Reference {
  line: number;
  path: string;
}

/**
 * Relative markdown links (inline and reference style) and `prefix/paths` in backticks, with
 * their line numbers. Skips URLs, anchors, globs, placeholders and anything inside code fences.
 */
function referencedPaths(markdown: string, fileDir: string): Reference[] {
  const found: Reference[] = [];
  let inFence = false;
  markdown.split("\n").forEach((text, i) => {
    if (/^\s*```/.test(text)) inFence = !inFence;
    if (inFence || /^\s*```/.test(text)) return;
    const line = i + 1;
    const targets = [
      ...[...text.matchAll(/\]\(<?([^)\s>]+)/g)].map((m) => m[1] ?? ""),
      ...[...text.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/g)].map((m) => m[1] ?? ""),
    ];
    for (const raw of targets) {
      const target = decodeURIComponent(raw.split(/[#?]/)[0] ?? "");
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, ...
      found.push({ line, path: normalize(join(fileDir, target)) });
    }
    const ticks = new RegExp("`((?:" + PATH_PREFIXES + ")/[^`\\s]*)`", "g");
    for (const m of text.matchAll(ticks)) {
      const path = (m[1] ?? "")
        .replace(/(:\d+)+(-\d+)?$/, "")
        .replace(/#L\d+.*$/, "")
        .replace(/[.,;:]+$/, "");
      if (/[*<>{}]|\.\.\./.test(path)) continue; // glob or placeholder, not a real path
      found.push({ line, path });
    }
  });
  return found;
}

describe("documentation points at files that exist", () => {
  it("the docs that must exist do exist", () => {
    expect(REQUIRED_DOCS.filter((d) => !exists(d))).toEqual([]);
  });

  for (const doc of DOCS.filter(exists)) {
    it(doc, () => {
      const missing = referencedPaths(read(doc), dirname(doc))
        .filter((r) => !exists(r.path) && !FORBIDDEN_ON_PURPOSE.has(r.path))
        .map((r) => `${doc}:${r.line}: ${r.path}`);
      expect(
        missing,
        `${doc} points at paths that do not exist. Fix the path, or restore the file if a rename was a mistake. Missing:`,
      ).toEqual([]);
    });
  }

  it("the paths the docs forbid really do not exist", () => {
    for (const p of FORBIDDEN_ON_PURPOSE) expect(exists(p), p).toBe(false);
  });

  it("understands links, backtick paths, code fences and what to ignore", () => {
    const md = [
      "[ok](./a.md) [web](https://x.dev) [anchor](#top) [part](b.md#part) [q](c.md?plain=1)",
      "[ref]: ./d.md",
      "`src/services/x.ts:12:3` `docs/y/` `src/**/*.ts` `src/<module>/` `e2e/z.py.` `src/routes/$.ts`",
      "```",
      "`src/in/a/fence.ts` [no](nope.md)",
      "```",
    ].join("\n");
    expect(referencedPaths(md, "docs")).toEqual([
      { line: 1, path: "docs/a.md" },
      { line: 1, path: "docs/b.md" },
      { line: 1, path: "docs/c.md" },
      { line: 2, path: "docs/d.md" },
      { line: 3, path: "src/services/x.ts" },
      { line: 3, path: "docs/y/" },
      { line: 3, path: "e2e/z.py" },
      { line: 3, path: "src/routes/$.ts" },
    ]);
  });
});

// ---------- 3. module READMEs ----------
const MODULE_README_SECTIONS = [
  "Purpose",
  "What it does NOT do",
  "Files",
  "Main flow",
  "Rules that must not break",
  "How to test",
  "Common mistakes",
] as const;

function missingSections(markdown: string): string[] {
  const headings = new Set(
    [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => (m[1] ?? "").trim()),
  );
  return MODULE_README_SECTIONS.filter((s) => !headings.has(s));
}

describe("module READMEs have the same seven sections", () => {
  it("finds the missing ones", () => {
    expect(missingSections("## Purpose\n\n## Files\n")).toEqual([
      "What it does NOT do",
      "Main flow",
      "Rules that must not break",
      "How to test",
      "Common mistakes",
    ]);
  });

  for (const readme of walk("src/services", (p) => p.endsWith("README.md"))) {
    it(readme, () => {
      expect(
        missingSections(read(readme)),
        `${readme} needs these "## " headings (see AGENTS.md > Repository rules):`,
      ).toEqual([]);
    });
  }
});

// ---------- 4. English only ----------
// Two checks, both only a guard: letters that exist in Portuguese but not in English or Swedish
// (the demo data has Swedish names), and a short list of Portuguese words written without accents.
// Escapes keep this file free of the characters it looks for. The word list is built from pieces
// for the same reason, and this file is skipped by the word check.
const ACCENTED = /[\u00e3\u00f5\u00e7\u00ea\u00f4\u00e2\u00e1\u00ed\u00fa]/;
const PLAIN_WORDS = [
  "na" + "o",
  "voc" + "e",
  "func" + "ao",
  "func" + "oes",
  "valida" + "cao",
  "configura" + "cao",
  "altera" + "cao",
  "descri" + "cao",
  "informa" + "cao",
  "tamb" + "em",
  "ent" + "ao",
  "arqu" + "ivo",
  "tare" + "fa",
];
const PLAIN = new RegExp(`\\b(${PLAIN_WORDS.join("|")})\\b`, "i");
const SELF = "src/test/repo-hygiene.test.ts";

/** Where text is ours to write. docs/rebuild holds copies of original briefs and is left out on purpose. */
const ENGLISH_ONLY_FILES = [
  ...walk("src", (p) => /\.(ts|tsx|js|jsx|css|md)$/.test(p) && !p.endsWith("routeTree.gen.ts")),
  ...walk("e2e", () => true),
  ...walk("docs/architecture", () => true),
  ...walk("docs/operations", () => true),
  ...walk("docs/decisions", () => true),
  ...walk(".kiro/steering", () => true),
  "README.md",
  "AGENTS.md",
  "docs/development.md",
  "roadmap.md",
];

/** "file:line: text" for each line that looks Portuguese. */
function portugueseLines(file: string, text: string): string[] {
  return text.split("\n").flatMap((line, i) => {
    const hit = ACCENTED.test(line) || (file !== SELF && PLAIN.test(line));
    return hit ? [`${file}:${i + 1}: ${line.trim().slice(0, 80)}`] : [];
  });
}

describe("the repository is written in English", () => {
  it("spots Portuguese and ignores English and Swedish text", () => {
    const sample = [
      "Hello",
      "A\u00e7\u00e3o aqui",
      "Fj\u00e4rrv\u00e4rme Syd AB",
      "n" + "ao alterar",
      "Fine: nano and nation",
    ].join("\n");
    expect(portugueseLines("x.md", sample)).toEqual([
      "x.md:2: A\u00e7\u00e3o aqui",
      "x.md:4: n" + "ao alterar",
    ]);
  });

  it("no file we maintain contains Portuguese", () => {
    // A missing required doc is reported by its own test above; here it is simply skipped.
    const found = ENGLISH_ONLY_FILES.filter(exists).flatMap((f) => portugueseLines(f, read(f)));
    expect(
      found,
      "Repository text is English only (see AGENTS.md > Repository rules). Translate these lines. " +
        "Swedish names in demo data are fine. Offending lines:",
    ).toEqual([]);
  });
});

// ---------- 5. rebuild handbook copies ----------
describe("the rebuild handbook copies match their sources", () => {
  it("nothing has drifted", () => {
    // process.execPath is the node binary running the tests, so this does not depend on PATH.
    const run = spawnSync(process.execPath, ["scripts/sync-rebuild.mjs", "--check"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(
      run.status,
      (run.error?.message ?? run.stdout ?? run.stderr) +
        "\nEdit the source (src/ or contracts/), never the copy, then run `bun run sync:rebuild` and commit both.",
    ).toBe(0);
  });
});
