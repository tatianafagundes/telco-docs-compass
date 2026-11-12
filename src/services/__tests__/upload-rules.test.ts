import { describe, expect, it } from "vitest";
import {
  batchSummary,
  blocksAdding,
  defaultType,
  fileIssues,
  middleTruncate,
  nextPipelineState,
  shortEntityId,
  simulatedOutcome,
  uploadProgress,
  type UploadSpec,
} from "@/services/upload-rules";

const specs: UploadSpec[] = [
  { code: "orderAttachment", name: "Order attachment", acceptedMimeTypes: ["application/pdf", "image/png"], maxSizeMb: 100, requiredFields: [] },
  { code: "contract", name: "Contract", acceptedMimeTypes: ["application/pdf"], maxSizeMb: 50, requiredFields: [] },
  { code: "regulatory", name: "Regulatory", acceptedMimeTypes: ["application/pdf"], maxSizeMb: null, requiredFields: ["authorityRef"] },
];

describe("upload rules", () => {
  it("should default to order attachment when added to an order", () => {
    expect(defaultType("order", "contract.pdf", specs)).toEqual({ code: "orderAttachment", reason: "Based on: added to an order" });
  });
  it("should default to contract on an account only when the name has a contract word", () => {
    expect(defaultType("account", "Master agreement.pdf", specs).code).toBe("contract");
    expect(defaultType("account", "Site survey.pdf", specs).code).toBe("orderAttachment");
  });
  it("should never default to a type with required typed fields", () => {
    const onlyRequired = specs.filter((s) => s.code === "regulatory");
    expect(defaultType("order", "a.pdf", onlyRequired).code).toBeNull();
  });
  it("should block files over the size limit of 100 MB", () => {
    const issues = fileIssues({ name: "big.pdf", size: 101 * 1024 * 1024, mimeType: "application/pdf" }, specs[0], []);
    expect(issues.map((i) => i.kind)).toEqual(["size"]);
    expect(blocksAdding(issues)).toBe(true);
  });
  it("should block a file type the document type doesn't accept", () => {
    expect(blocksAdding(fileIssues({ name: "a.exe", size: 10, mimeType: "application/x-msdownload" }, specs[0], []))).toBe(true);
  });
  it("should only warn on a duplicate name", () => {
    const issues = fileIssues({ name: "Plan.PDF", size: 10, mimeType: "application/pdf" }, specs[0], [{ id: "d1", name: "plan.pdf" }]);
    expect(issues[0]?.kind).toBe("duplicate");
    expect(blocksAdding(issues)).toBe(false);
  });
  it("should quarantine .exe files and TEST-QUARANTINE content", () => {
    expect(simulatedOutcome("tool.exe", "")).toBe("quarantined");
    expect(simulatedOutcome("a.pdf", "xx TEST-QUARANTINE xx")).toBe("quarantined");
    expect(simulatedOutcome("a.pdf", "TEST-UNREADABLE")).toBe("unreadable");
    expect(simulatedOutcome("Site survey.pdf", "Malmö depot")).toBe("ready");
  });
  it("should walk uploading to ready, or stop at quarantined/failed", () => {
    expect(nextPipelineState("uploading", "ready")).toBe("scanning");
    expect(nextPipelineState("scanning", "ready")).toBe("reading");
    expect(nextPipelineState("reading", "ready")).toBe("ready");
    expect(nextPipelineState("scanning", "quarantined")).toBe("quarantined");
    expect(nextPipelineState("reading", "unreadable")).toBe("failed");
  });
  it("should summarise a finished batch as '3 added: 2 ready, 1 needs attention'", () => {
    expect(batchSummary(["ready", "ready", "attention"])).toEqual({ done: true, attention: 1, line: "3 added: 2 ready, 1 needs attention" });
    expect(batchSummary(["ready", "checking"]).done).toBe(false);
  });
  it("should never show 100 % while files are still being checked", () => {
    expect(uploadProgress([1, 1], false)).toBe(99);
    expect(uploadProgress([1, 1], true)).toBe(100);
  });
  it("should keep the extension when shortening names", () => {
    const s = middleTruncate("Site_survey_-_Site_C_Helsingborg_yard_with_a_very_long_name.pdf", 30);
    expect(s.endsWith(".pdf")).toBe(true);
    expect(s.length).toBe(30);
  });
  it("should shorten entity ids for the drop overlay", () => {
    expect(shortEntityId("ord-se-7731")).toBe("O-7731");
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import { formatSize } from "@/services/upload-rules";

describe("BR-063 default type reasons", () => {
  it("BR-063 reasons: contract word on an account, order, safest general type, none", () => {
    expect(defaultType("account", "Master agreement.pdf", specs)).toEqual({ code: "contract", reason: "Based on: the file name mentions a contract" });
    expect(defaultType("order", "x.pdf", specs)).toEqual({ code: "orderAttachment", reason: "Based on: added to an order" });
    expect(defaultType("account", "Site survey.pdf", specs)).toEqual({ code: "orderAttachment", reason: "Based on: the safest general type" });
    expect(defaultType("account", "Master agreement.pdf", [])).toEqual({ code: null, reason: "Choose a type for this file" });
  });
  it("BR-063 every contract word counts, case-insensitively, and only on an account", () => {
    for (const w of ["CONTRACT", "Agreement", "avtal", "Kontrakt", "MSA"]) expect(defaultType("account", `${w}-2026.pdf`, specs).code).toBe("contract");
    expect(defaultType("order", "contract.pdf", specs).code).toBe("orderAttachment");
  });
});

describe("BR-064/BR-065/BR-066 file issue messages", () => {
  it("BR-064 wrong file type message", () => {
    expect(fileIssues({ name: "a.zip", size: 10, mimeType: "application/zip" }, specs[0], [])).toEqual([
      { kind: "type", message: "Order attachment accepts PDF or PNG files. Choose another type, or another file." },
    ]);
    expect(fileIssues({ name: "a.png", size: 10, mimeType: "image/png" }, specs[1], [])[0]?.message).toBe("Contract accepts PDF files. Choose another type, or another file.");
  });
  it("BR-065 too large message", () => {
    expect(fileIssues({ name: "big.pdf", size: 101 * 1024 * 1024, mimeType: "application/pdf" }, specs[0], [])).toEqual([
      { kind: "size", message: "This file is 101.0 MB. Order attachment files can be up to 100 MB." },
    ]);
    expect(fileIssues({ name: "ok.pdf", size: 100 * 1024 * 1024, mimeType: "application/pdf" }, specs[0], [])).toEqual([]);
  });
  it("BR-066 duplicate name message uses the existing document's name and only warns", () => {
    const issues = fileIssues({ name: "PLAN.pdf", size: 10, mimeType: "application/pdf" }, specs[0], [{ id: "d1", name: "plan.pdf" }]);
    expect(issues).toEqual([{ kind: "duplicate", message: "A document called plan.pdf is already here.", existingId: "d1", existingName: "plan.pdf" }]);
    expect(blocksAdding(issues)).toBe(false);
  });
});

describe("BR-068 size and name formatting", () => {
  it("BR-068 size: B, then KB rounded, then MB with one decimal", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1536)).toBe("2 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
  it("BR-068 names up to 40 characters are untouched; longer ones are shortened in the middle at 40", () => {
    const short = "Site survey – Helsingborg yard.pdf";
    expect(middleTruncate(short)).toBe(short);
    const long = "Site_survey_-_Site_C_Helsingborg_yard_with_a_very_long_name.pdf";
    expect(middleTruncate(long)).toHaveLength(40);
    expect(middleTruncate(long)).toMatch(/^Site_survey.*….*\.pdf$/);
  });
});
