// Keeps the self-contained rebuild handbook (docs/rebuild) in line with the real sources.
//
// The handbook is meant to be handed over as one folder, so it carries its own copies of the
// contracts, the migrations and the reference rules and tests. This script refreshes them:
//   node scripts/sync-rebuild.mjs           copy the sources over the copies
//   node scripts/sync-rebuild.mjs --check   change nothing; exit 1 and list what drifted
// `bun run sync:rebuild` runs the first form. src/test/repo-hygiene.test.ts runs the second, so
// `bun run check` fails when a copy is out of date.
//
// What is mirrored:
//   contracts/**                  -> docs/rebuild/contracts/**                (whole folder)
//   drizzle/migrations/*.sql      -> docs/rebuild/reference/postgres-schema/  (whole folder)
//   src/services/<name>           -> docs/rebuild/reference/rules/<name>      (files already in the folder)
//   src/services/__tests__/<name> -> docs/rebuild/reference/rule-tests/<name> (files already in the folder,
//                                    except *.integration.test.ts: those are edited on purpose so that
//                                    no demo password is stored in the handbook)
// A new `*-rules.ts` in src/services is reported until it has been copied into the handbook once.
//
// Exit codes: 0 up to date (or synced), 1 drift found (--check), 2 the layout is not what this script expects.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// The repository root is found from this file, so the script works from any folder.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const abs = (p) => join(root, p);

/** Files under `dir` (paths relative to the root) that `keep` accepts. Symlinks are never followed. */
function files(dir, keep = () => true) {
  if (!existsSync(abs(dir))) return [];
  return readdirSync(abs(dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    if (lstatSync(abs(rel)).isSymbolicLink()) return [];
    if (entry.isDirectory()) return files(rel, keep);
    return keep(rel) ? [rel] : [];
  });
}

// Refuse to run when the layout is not what this script expects. A renamed or emptied source
// folder would otherwise look like "nothing to do", or worse, make every copy look orphaned.
for (const dir of [
  "contracts",
  "drizzle/migrations",
  "src/services",
  "src/services/__tests__",
  "docs/rebuild",
]) {
  if (!existsSync(abs(dir))) {
    console.error(`sync-rebuild: ${dir} not found under ${root}`);
    process.exit(2);
  }
}
const isSql = (p) => p.endsWith(".sql");
if (files("contracts").length === 0 || files("drizzle/migrations", isSql).length === 0) {
  console.error("sync-rebuild: a source folder is empty; refusing to continue");
  process.exit(2);
}

/** Whole-folder mirror: every source file must be in the copy with the same bytes, and nothing extra. */
function mirror(srcDir, dstDir, keep) {
  const src = files(srcDir, keep).map((p) => relative(srcDir, p));
  const dst = files(dstDir, keep).map((p) => relative(dstDir, p));
  return [
    ...src.map((name) => ({ from: join(srcDir, name), to: join(dstDir, name) })),
    ...dst.filter((n) => !src.includes(n)).map((name) => ({ remove: join(dstDir, name) })),
  ];
}

/** Only the files already present in the copy folder are refreshed. */
function named(srcDir, dstDir, skip = () => false) {
  return files(dstDir)
    .map((p) => relative(dstDir, p))
    .filter((name) => !skip(name))
    .map((name) => ({ from: join(srcDir, name), to: join(dstDir, name) }));
}

const plan = [
  ...mirror("contracts", "docs/rebuild/contracts"),
  ...mirror("drizzle/migrations", "docs/rebuild/reference/postgres-schema", isSql),
  ...named("src/services", "docs/rebuild/reference/rules"),
  ...named("src/services/__tests__", "docs/rebuild/reference/rule-tests", (name) =>
    name.endsWith(".integration.test.ts"),
  ),
];

const drift = [];

// A rules file that was never bundled cannot drift, so it would go unnoticed: report it.
const rulesDir = "docs/rebuild/reference/rules";
const bundled = new Set(files(rulesDir).map((p) => relative(rulesDir, p)));
for (const p of files("src/services", (f) => /-rules\.ts$/.test(f))) {
  const name = relative("src/services", p);
  if (!name.includes("/") && !p.includes("__tests__") && !bundled.has(name)) {
    drift.push(`not in the handbook yet: ${p} (copy it once into ${rulesDir}/)`);
  }
}

for (const step of plan) {
  if (step.remove) {
    drift.push(`extra copy with no source: ${step.remove}`);
    if (!check) rmSync(abs(step.remove));
    continue;
  }
  if (!existsSync(abs(step.from))) {
    drift.push(`the source is gone: ${step.from} (copy: ${step.to})`);
    continue;
  }
  const exists = existsSync(abs(step.to));
  if (exists && readFileSync(abs(step.from)).equals(readFileSync(abs(step.to)))) continue;
  drift.push(`${exists ? "differs" : "missing"}: ${step.to}  (source: ${step.from})`);
  if (!check) {
    mkdirSync(dirname(abs(step.to)), { recursive: true });
    copyFileSync(abs(step.from), abs(step.to));
  }
}

if (check) {
  if (drift.length > 0) {
    console.log(
      `The rebuild handbook copies are out of date (${drift.length}):\n  ${drift.join("\n  ")}\nRun: bun run sync:rebuild`,
    );
    process.exit(1);
  }
  console.log("rebuild handbook copies are up to date");
} else {
  console.log(
    drift.length > 0
      ? `updated ${drift.length} item(s):\n  ${drift.join("\n  ")}`
      : "nothing to update",
  );
}
