// File events come from the database trigger only (file-hooks spec D2, R1.1–R1.4, task 4.1). This
// keeps every code path that changes a document's processing state or purges it on a write the
// trigger sees, guarded where the change is decided from an earlier read, and no code path writes a
// file event or the outbox itself. It reads the TypeScript syntax tree (not text), so quoted,
// shorthand and computed keys count too. A new writer fails here until it is reviewed and listed.
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const COLUMNS = new Set(["pipeline_state", "purged_at"]);
const FILE_EVENTS = [
  "DocumentFileStoredEvent",
  "DocumentFileReadyToReadEvent",
  "DocumentFilePurgedEvent",
];
const SKIP = /(__tests__|\/test\/|integrations\/supabase\/types\.ts$|\.test\.tsx?$)/;
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(p) && !SKIP.test(p) ? [p] : [];
  });
}
const sources = walk("src").map((p) => ({
  path: relative("src", p),
  sf: ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true),
}));

const keyName = (n: ts.PropertyName | undefined): string | null => {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
    return n.text;
  if (ts.isComputedPropertyName(n) && ts.isStringLiteralLike(n.expression))
    return n.expression.text;
  return null;
};
const calleeName = (c: ts.CallExpression) =>
  ts.isPropertyAccessExpression(c.expression)
    ? c.expression.name.text
    : ts.isIdentifier(c.expression)
      ? c.expression.text
      : "";
interface Write {
  file: string;
  line: number;
  /** Where the write sits: "patch" or "expect" of updateDocumentIf, "insert", "update", or "assign". */
  context: string;
  value: ts.Expression | undefined;
}
/** Every object key or assignment that names one of the columns, with its context. */
function writes(): Write[] {
  const out: Write[] = [];
  for (const { path, sf } of sources) {
    const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const contextOf = (obj: ts.Node): string => {
      let n: ts.Node = obj;
      while (n.parent) {
        const p = n.parent;
        if (ts.isPropertyAssignment(p) && keyName(p.name) === "expect") return "expect";
        if (ts.isCallExpression(p) && p.arguments.includes(n as ts.Expression)) {
          const name = calleeName(p);
          if (name === "updateDocumentIf")
            return p.arguments.indexOf(n as ts.Expression) === 2 ? "patch" : "expect";
          return name;
        }
        n = p;
      }
      return "literal";
    };
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
        const k = keyName(n.name);
        if (k && COLUMNS.has(k) && ts.isObjectLiteralExpression(n.parent))
          out.push({
            file: path,
            line: at(n),
            context: contextOf(n.parent),
            value: ts.isPropertyAssignment(n) ? n.initializer : undefined,
          });
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const l = n.left;
        const k = ts.isPropertyAccessExpression(l)
          ? l.name.text
          : ts.isElementAccessExpression(l) && ts.isStringLiteralLike(l.argumentExpression)
            ? l.argumentExpression.text
            : null;
        if (k && COLUMNS.has(k))
          out.push({ file: path, line: at(n), context: "assign", value: n.right });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
const ALL = writes();

/** Files that set pipeline_state or purged_at, and how each write reaches the trigger. */
const WRITERS: Record<string, string> = {
  "services/pipeline-step.ts": "every step, guarded on state, version and attempt",
  "services/document-add-version.ts": "new or restored version, guarded",
  "services/document-content.functions.ts": "register (insert) and Keep without reading (guarded)",
  "services/gateway-create.ts": "API register (insert)",
  "services/pipeline.functions.ts": "usability-test reset purges (update)",
  "services/retention.functions.ts": "permanent deletion (update)",
  "services/file-hook-versions.ts": "guard values only, no write",
  "services/file-result-target.ts": "scan and extraction answers, guarded",
};
// Writes decided from an earlier read: only as a guarded patch, or as the guard itself.
const GUARDED = [
  "services/pipeline-step.ts",
  "services/document-add-version.ts",
  "services/document-content.functions.ts",
  "services/file-result-target.ts",
];
const fileOf = (p: string) => sources.find((s) => s.path === p)!.sf;

describe("paths that change processing state or purge", () => {
  it("are exactly the reviewed ones, anywhere under src", () => {
    expect([...new Set(ALL.map((w) => w.file))].sort()).toEqual(Object.keys(WRITERS).sort());
  });
  it.each(GUARDED)("%s sets processing state only through updateDocumentIf", (file) => {
    const sf = fileOf(file);
    for (const w of ALL.filter((x) => x.file === file)) {
      const where = `${file}:${w.line}`;
      if (w.context === "assign") {
        // `update.pipeline_state = …` is allowed only for an object then passed as the guarded patch.
        expect(sf.getText(), where).toMatch(/updateDocumentIf\(\s*[\s\S]*?,\s*update,/);
        continue;
      }
      expect(["patch", "expect", "insert"], where).toContain(w.context);
    }
  });
  it("inserts start a document only as uploading (or ready for already-checked content)", () => {
    // The trigger fires on updates: a document inserted straight into scanning or reading would send no event.
    const ok = (e: ts.Expression | undefined): boolean =>
      !!e &&
      (ts.isStringLiteral(e)
        ? e.text === "uploading" || e.text === "ready"
        : ts.isConditionalExpression(e) && ok(e.whenTrue) && ok(e.whenFalse));
    for (const w of ALL.filter((x) => x.context === "insert" && x.value))
      expect(ok(w.value), `${w.file}:${w.line}`).toBe(true);
  });
  it("never write a file event themselves: only the trigger does", () => {
    const allowed = new Set(["services/tmf667-events.ts", "services/file-hook-rules.ts"]);
    for (const { path, sf } of sources.filter((s) => !allowed.has(s.path))) {
      const strings: string[] = [];
      const visit = (n: ts.Node): void => {
        if (ts.isStringLiteralLike(n)) strings.push(n.text);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      for (const e of FILE_EVENTS) expect(strings, `${path}: ${e}`).not.toContain(e);
    }
  });
  it("name the outbox only where it is read, delivered or given the bulk batch event", () => {
    const naming = sources
      .filter(({ sf }) => {
        let hit = false;
        const visit = (n: ts.Node): void => {
          if (ts.isStringLiteralLike(n) && n.text === "event_outbox") hit = true;
          ts.forEachChild(n, visit);
        };
        visit(sf);
        return hit;
      })
      .map((s) => s.path)
      .sort();
    expect(naming).toEqual(["services/bulk-worker.ts", "services/tmf-events.ts"]);
    // Writes chained on from("event_outbox"): only the bulk batch insert.
    const outboxWrites: string[] = [];
    for (const { path, sf } of sources) {
      const visit = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          calleeName(n) === "from" &&
          n.arguments[0] &&
          ts.isStringLiteralLike(n.arguments[0]) &&
          n.arguments[0].text === "event_outbox"
        ) {
          let up: ts.Node = n;
          while (ts.isPropertyAccessExpression(up.parent) || ts.isCallExpression(up.parent)) {
            up = up.parent;
            if (
              ts.isPropertyAccessExpression(up) &&
              ["insert", "upsert", "delete"].includes(up.name.text)
            )
              outboxWrites.push(`${path}:${up.name.text}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(outboxWrites).toEqual(["services/bulk-worker.ts:insert"]);
  });
  it("no migration sets processing state or purges outside the trigger functions", () => {
    for (const f of readdirSync("drizzle/migrations").filter((x) => x.endsWith(".sql"))) {
      const sql = readFileSync(join("drizzle/migrations", f), "utf8").replace(/--[^\n]*/g, "");
      expect(sql, f).not.toMatch(/\bSET\s+(?:[^;]*,\s*)?(pipeline_state|purged_at)\s*=/i);
    }
  });
});
