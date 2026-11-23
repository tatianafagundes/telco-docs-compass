// File events come from the database trigger only (file-hooks spec D2, R1.1–R1.4, task 4.1). This
// keeps every code path that changes a document's processing state or purges it on a write the
// trigger sees, guarded where the change is decided from an earlier read, and no code path writes a
// file event itself. A new writer fails here until it is reviewed and listed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = "src/services";
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ name: f, src: readFileSync(join(DIR, f), "utf8") }));
// Code only: comments may mention the columns.
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Files that set pipeline_state or purged_at, and how each write reaches the trigger. */
const WRITERS: Record<string, string> = {
  "pipeline-step.ts": "every step, guarded on state, version and attempt",
  "document-add-version.ts": "new or restored version, guarded",
  "document-content.functions.ts": "register (insert) and Keep without reading (guarded)",
  "gateway-create.ts": "API register (insert)",
  "pipeline.functions.ts": "usability-test reset purges (update)",
  "retention.functions.ts": "permanent deletion (update)",
  "file-hook-versions.ts": "guard values only, no write",
};
// An assignment or object key, not a comparison (===) or a type (: PipelineState).
const WRITE = /\b(?:pipeline_state|purged_at)\s*(?::|=(?!=))\s*(?!\s|PipelineState\b|string\b)/;
// Files whose state writes are decided from an earlier read and must be guarded.
const GUARDED = ["pipeline-step.ts", "document-add-version.ts", "document-content.functions.ts"];
const FILE_EVENTS = [
  "DocumentFileStoredEvent",
  "DocumentFileReadyToReadEvent",
  "DocumentFilePurgedEvent",
];

describe("paths that change processing state or purge", () => {
  it("are exactly the reviewed ones", () => {
    const found = files
      .filter((f) =>
        code(f.src)
          .split("\n")
          .some((l) => WRITE.test(l) && !/select\(/.test(l)),
      )
      .map((f) => f.name)
      .sort();
    expect(found).toEqual(Object.keys(WRITERS).sort());
  });
  it.each(GUARDED)("%s writes processing state through updateDocumentIf", (name) => {
    const src = code(files.find((f) => f.name === name)!.src);
    expect(src).toContain("updateDocumentIf(");
    // No plain update that sets the state next to it.
    expect(src).not.toMatch(/\.update\(\{[^}]*pipeline_state/);
  });
  it("never write a file event themselves: only the trigger does", () => {
    const allowed = new Set(["tmf667-events.ts", "file-hook-rules.ts"]);
    for (const f of files.filter((x) => !allowed.has(x.name)))
      for (const e of FILE_EVENTS) expect(code(f.src), `${f.name}: ${e}`).not.toContain(e);
  });
  it("insert into the outbox only for the bulk batch event", () => {
    const inserting = files
      .filter((f) => /from\("event_outbox"\)\s*\.insert/.test(code(f.src)))
      .map((f) => f.name);
    expect(inserting).toEqual(["bulk-worker.ts"]);
    const bulk = code(files.find((f) => f.name === "bulk-worker.ts")!.src);
    expect(bulk).toMatch(/event_type:\s*"DocumentBatchEvent"/);
  });
});
