// A new version, a restore and "Keep without reading" never undo a quarantine or skip a scan
// (file-hooks spec R4.8, R5.2, D5; task 2.3).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_QUARANTINED_VERSIONS } from "@/services/file-hook-detail";
import { keepUnread, versionStart } from "@/services/file-hook-versions";

const V = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

describe("versionStart", () => {
  it("starts again from uploading and keeps every quarantined version", () => {
    expect(versionStart("ready", { quarantinedVersions: [V2], attempt: 3 }, V)).toEqual({
      ok: true,
      state: "uploading",
      // The attempt goes on counting, so a late answer about an earlier attempt never matches.
      detail: { attempt: 3, quarantinedVersions: [V2] },
      expect: { pipeline_state: "ready", current_version_id: V, "pipeline_detail->>attempt": "3" },
    });
  });
  it("refuses a stored attempt the database cannot compare", () => {
    expect(versionStart("ready", { attempt: [1] }, V)).toEqual({ ok: false, code: "badDetail" });
  });
  it("adds the current version of a document quarantined before the list existed", () => {
    expect(versionStart("quarantined", { reason: "threat" }, V)).toMatchObject({
      ok: true,
      detail: { quarantinedVersions: [V] },
    });
  });
  it("never restores a quarantined version, also an old one or one quarantined before the list", () => {
    expect(versionStart("ready", { quarantinedVersions: [V2] }, V, V2)).toEqual({
      ok: false,
      code: "quarantined",
    });
    expect(versionStart("quarantined", null, V, V.toUpperCase())).toEqual({
      ok: false,
      code: "quarantined",
    });
  });
  it("restores a version that was never quarantined, to be checked again", () => {
    expect(versionStart("ready", { quarantinedVersions: [V2] }, V, V)).toMatchObject({
      ok: true,
      state: "uploading",
    });
  });
  it("refuses a new version rather than forget a quarantined one", () => {
    const ids = Array.from(
      { length: MAX_QUARANTINED_VERSIONS },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(versionStart("ready", { quarantinedVersions: ids }, V)).toEqual({
      ok: false,
      code: "quarantineFull",
    });
  });
});

describe("keepUnread", () => {
  it.each([
    ["a reading that failed", { reason: "unreadable", step: "read" }, true],
    ["an old reading failure", { reason: "unreadableAgain" }, true],
    ["an old failure with no detail", null, true],
    ["a reader that did not answer", { reason: "noResult", step: "read" }, true],
    ["a scan error", { reason: "scanError", step: "scan" }, false],
    ["an old scan error with no step", { reason: "scanError" }, false],
    ["a scanner that did not answer", { reason: "noResult", step: "scan" }, false],
    ["a file that never arrived", { reason: "noFile" }, false],
    // A timeout that recorded no step may have been the scan: never kept unread (legacy rows).
    ["an old timeout with no step", { reason: "noResult" }, false],
  ])("%s → %s", (_n, detail, allowed) => {
    const r = keepUnread("failed", detail, V);
    expect(r.ok).toBe(allowed);
    if (!r.ok) expect(r.code).toBe("notReadingFailure");
  });
  it("only for a failed document, and keeps the quarantine list", () => {
    expect(keepUnread("scanning", null, V)).toEqual({ ok: false, code: "notFailed" });
    expect(keepUnread("failed", { reason: "unreadable", quarantinedVersions: [V2] }, V)).toEqual({
      ok: true,
      detail: { note: "notRead", attempt: 0, quarantinedVersions: [V2] },
      // Guarded on the version that failed: one added meanwhile is never marked ready unchecked.
      expect: {
        pipeline_state: "failed",
        current_version_id: V,
        "pipeline_detail->>attempt": null,
      },
    });
  });
});

describe("the server functions use these rules", () => {
  const src = readFileSync("src/services/document-content.functions.ts", "utf8");
  it("never clears pipeline_detail or writes the old keep-unread detail", () => {
    expect(src).not.toMatch(/pipeline_detail:\s*null/);
    expect(src).not.toMatch(/pipeline_detail\s*=\s*\{\s*note/);
    expect(src).toContain(
      "keepUnread(doc.pipeline_state, doc.pipeline_detail, doc.current_version_id)",
    );
    expect(src).toMatch(
      /updateDocumentIf\([\s\S]*?expect: keep\?\.ok \? \{ \.\.\.keep\.expect \} : \{\}/,
    );
    const add = readFileSync("src/services/document-add-version.ts", "utf8");
    expect(add).not.toMatch(/pipeline_detail:\s*null/);
    expect(add).toMatch(/updateDocumentIf\([\s\S]*?expect: \{ \.\.\.start\.expect \}/);
  });
});
describe("media types are a type and subtype, never free text (they reach file events)", () => {
  it.each([
    ["application/pdf", true],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", true],
    ["image/svg+xml", true],
    ["application/my secret plan", false],
    ["text/plain; charset=utf-8", false],
    ["Merger plan for Borealis", false],
    ["a/b/c", false],
  ])("%s → %s", async (mimeType, ok) => {
    const { registerSchema } = await import("@/schemas/document");
    const { attachmentSchema } = await import("@/services/gateway-create-input");
    expect(attachmentSchema.shape.mimeType.safeParse(mimeType).success).toBe(ok);
    expect(registerSchema.shape.mimeType.safeParse(mimeType).success).toBe(ok);
  });
});
