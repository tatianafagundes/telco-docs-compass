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
