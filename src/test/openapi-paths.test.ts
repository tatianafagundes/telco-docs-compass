// The published contract names every public TMF route, and nothing the app does not answer.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTES = "src/routes/api/public/tmf-api/document/v4";
const fromRoute = (f: string) =>
  "/" +
  f
    .replace(/\.ts$/, "")
    .split(".")
    .map((p) => (p.startsWith("$") ? `{${p.slice(1)}}` : p))
    .join("/");
describe("contracts/seams/tmf667-document.openapi.yaml", () => {
  it("lists exactly the routes under document/v4", () => {
    const yaml = readFileSync("contracts/seams/tmf667-document.openapi.yaml", "utf8");
    const paths = [...yaml.matchAll(/^ {2}(\/[^:\s]+):\s*$/gm)].map((m) => m[1]).sort();
    const routes = readdirSync(ROUTES)
      .filter((f) => f.endsWith(".ts"))
      .map(fromRoute)
      .sort();
    expect(paths).toEqual(routes);
  });
});
