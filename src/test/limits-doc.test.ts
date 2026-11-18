// docs/architecture/limits.md lists every limit with its value and file. This keeps it true.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rows = [
  ...readFileSync("docs/architecture/limits.md", "utf8").matchAll(
    /^\| `(\w+)` \| (\d+) \| `([\w.-]+)` \|/gm,
  ),
].map((m) => ({ name: m[1]!, value: Number(m[2]), file: m[3]! }));

describe("the limits table matches the code", () => {
  it("lists rows", () => expect(rows.length).toBeGreaterThan(30));
  it.each(rows.map((r) => [r.name, r] as const))("%s", async (_n, r) => {
    const mod = (await import(`@/services/${r.file.replace(/\.ts$/, "")}`)) as Record<
      string,
      unknown
    >;
    expect(mod[r.name]).toBe(r.value);
  });
});
