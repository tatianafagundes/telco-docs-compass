// Pure rules for adding documents (prompt 05). No I/O, so they are unit-tested.
import type { PipelineState } from "@/schemas/document";

export interface UploadSpec {
  code: string;
  name: string;
  acceptedMimeTypes: string[];
  maxSizeMb: number | null;
  /** Names of required details the person would have to type. */
  requiredFields: string[];
}

export interface DefaultTypeChoice {
  code: string | null;
  reason: string;
}

const CONTRACT_WORDS = ["contract", "agreement", "avtal", "kontrakt", "msa"];
export const ORDER_ATTACHMENT = "orderAttachment";
export const CONTRACT = "contract";

/** Default type: never one whose required fields the person must type. */
export function defaultType(entityKind: string, fileName: string, specs: UploadSpec[]): DefaultTypeChoice {
  const usable = (code: string) => specs.find((s) => s.code === code && s.requiredFields.length === 0);
  const lower = fileName.toLowerCase();
  if (entityKind === "account" && CONTRACT_WORDS.some((w) => lower.includes(w)) && usable(CONTRACT)) {
    return { code: CONTRACT, reason: "Based on: the file name mentions a contract" };
  }
  if (usable(ORDER_ATTACHMENT)) {
    return { code: ORDER_ATTACHMENT, reason: entityKind === "order" ? "Based on: added to an order" : "Based on: the safest general type" };
  }
  return { code: null, reason: "Choose a type for this file" };
}

export type FileIssue =
  | { kind: "type"; message: string }
  | { kind: "size"; message: string }
  | { kind: "duplicate"; message: string; existingId: string; existingName: string };

export interface FileFacts {
  name: string;
  size: number;
  mimeType: string;
}

export function fileIssues(file: FileFacts, spec: UploadSpec | undefined, existing: { id: string; name: string }[]): FileIssue[] {
  const issues: FileIssue[] = [];
  if (spec && spec.acceptedMimeTypes.length > 0 && !spec.acceptedMimeTypes.includes(file.mimeType)) {
    issues.push({ kind: "type", message: `${spec.name} accepts ${acceptedLabel(spec.acceptedMimeTypes)} files. Choose another type, or another file.` });
  }
  if (spec?.maxSizeMb && file.size > spec.maxSizeMb * 1024 * 1024) {
    issues.push({ kind: "size", message: `This file is ${formatSize(file.size)}. ${spec.name} files can be up to ${spec.maxSizeMb} MB.` });
  }
  const dup = existing.find((d) => d.name.toLowerCase() === file.name.toLowerCase());
  if (dup) {
    issues.push({ kind: "duplicate", message: `A document called ${dup.name} is already here.`, existingId: dup.id, existingName: dup.name });
  }
  return issues;
}

/** Duplicates only warn; type and size block adding. */
export function blocksAdding(issues: FileIssue[]): boolean {
  return issues.some((i) => i.kind !== "duplicate");
}

const MIME_SHORT: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "application/zip": "ZIP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
};
function acceptedLabel(types: string[]): string {
  const names = types.map((t) => MIME_SHORT[t] ?? t);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : (names[0] ?? "");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shortens the middle and keeps the extension: "Site survey – Si….pdf". */
export function middleTruncate(name: string, max = 40): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const keep = max - ext.length - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  const base = name.slice(0, name.length - ext.length);
  return `${base.slice(0, head)}…${base.slice(base.length - tail)}${ext}`;
}

/** Short entity id for the drop overlay: "ord-se-7731" -> "O-7731". */
export function shortEntityId(id: string): string {
  const m = /^([a-z])[a-z]*-(?:[a-z]{2}-)?(.+)$/i.exec(id);
  return m ? `${m[1]!.toUpperCase()}-${m[2]}` : id;
}

/** Test hooks: what the simulated scan and reading decide for a file. */
export function simulatedOutcome(fileName: string, text: string): "quarantined" | "unreadable" | "ready" {
  if (fileName.toLowerCase().endsWith(".exe") || text.includes("TEST-QUARANTINE")) return "quarantined";
  if (text.includes("TEST-UNREADABLE")) return "unreadable";
  return "ready";
}

/** Next pipeline step. Reading always fails again on retry for unreadable files. */
export function nextPipelineState(current: PipelineState, outcome: ReturnType<typeof simulatedOutcome>): PipelineState {
  switch (current) {
    case "uploading":
      return "scanning";
    case "scanning":
      return outcome === "quarantined" ? "quarantined" : "reading";
    case "reading":
      return outcome === "unreadable" ? "failed" : "ready";
    default:
      return current;
  }
}

export type BatchFileState = "uploading" | "checking" | "ready" | "attention" | "cancelled";

export function batchSummary(states: BatchFileState[]): { done: boolean; line: string; attention: number } {
  const live = states.filter((s) => s !== "cancelled");
  const ready = live.filter((s) => s === "ready").length;
  const attention = live.filter((s) => s === "attention").length;
  const done = live.every((s) => s === "ready" || s === "attention");
  const n = live.length;
  const added = `${n} added`;
  const parts = [ready ? `${ready} ready` : null, attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : null].filter(Boolean);
  return { done, attention, line: parts.length ? `${added}: ${parts.join(", ")}` : added };
}

/** Upload-only progress; never 100 % while a file is still being checked. */
export function uploadProgress(loadedRatios: number[], allChecked: boolean): number {
  if (loadedRatios.length === 0) return 0;
  const avg = (loadedRatios.reduce((a, b) => a + b, 0) / loadedRatios.length) * 100;
  return allChecked ? Math.round(avg) : Math.min(Math.round(avg), 99);
}
