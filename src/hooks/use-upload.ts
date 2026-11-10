import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, newIdempotencyKey } from "@/services/api";
import type { PipelineState } from "@/schemas/document";
import type { BatchFileState } from "@/services/upload-rules";

export interface PlannedFile {
  key: string;
  file: File;
  documentType: string;
}

export interface UploadRow {
  key: string;
  name: string;
  file: File;
  documentType: string;
  docId: string | null;
  state: PipelineState | "error" | "cancelled";
  retried: boolean;
  uploaded: boolean;
}

const STEP_DELAY_MS = 700;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `sha256:${Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function batchState(row: UploadRow): BatchFileState {
  if (row.state === "cancelled") return "cancelled";
  if (row.state === "uploading" && !row.uploaded) return "uploading";
  if (row.state === "ready") return "ready";
  if (row.state === "failed" || row.state === "quarantined" || row.state === "error") return "attention";
  return "checking";
}

/** Adds files to one record: register, upload with the ticket, then walk the simulated pipeline. */
export function useUpload(entityId: string, entityRole: string) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const cancelled = useRef(new Set<string>());
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ["documents", { entityId }] }), [qc, entityId]);
  const patch = (key: string, p: Partial<UploadRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const walk = useCallback(
    async (key: string, docId: string, retry = false) => {
      let first = true;
      for (let i = 0; i < 6; i++) {
        await wait(STEP_DELAY_MS);
        const res = await api.advancePipeline({ id: docId, ...(retry && first ? { retry: true } : {}) });
        first = false;
        patch(key, { state: res.state, ...(retry ? { retried: true } : {}) });
        refresh();
        if (res.state === "ready" || res.state === "failed" || res.state === "quarantined") return;
      }
    },
    [refresh],
  );

  const runOne = useCallback(
    async (row: UploadRow) => {
      try {
        let docId = row.docId;
        if (!row.uploaded) {
          if (!docId) {
            const reg = await api.register({
              name: row.file.name,
              documentType: row.documentType,
              relatedEntity: { id: entityId, role: entityRole },
              mimeType: row.file.type || "application/octet-stream",
              size: row.file.size,
              contentHash: await sha256(row.file),
            });
            const doc = reg.document as { id: string; tenant_id: string } | null;
            if (!doc) throw new Error("register");
            docId = doc.id;
            patch(row.key, { docId });
            refresh();
            if (cancelled.current.has(row.key)) {
              await api.delete({ id: docId }).catch(() => undefined);
              refresh();
              return;
            }
            await api.uploadContent(`${doc.tenant_id}/${reg.upload.versionId}`, reg.upload.token, row.file);
          }
          patch(row.key, { uploaded: true });
        }
        if (docId) await walk(row.key, docId);
      } catch {
        patch(row.key, { state: "error" });
        refresh();
      }
    },
    [entityId, entityRole, refresh, walk],
  );

  const start = useCallback(
    (planned: PlannedFile[]) => {
      const fresh: UploadRow[] = planned.map((p) => ({
        key: p.key,
        name: p.file.name,
        file: p.file,
        documentType: p.documentType,
        docId: null,
        state: "uploading",
        retried: false,
        uploaded: false,
      }));
      setRows((rs) => [...fresh, ...rs.filter((r) => batchState(r) !== "ready" && batchState(r) !== "cancelled")]);
      fresh.forEach((r) => void runOne(r));
    },
    [runOne],
  );

  const cancel = (key: string) => {
    cancelled.current.add(key);
    patch(key, { state: "cancelled" });
  };

  const retryUpload = (row: UploadRow) => {
    patch(row.key, { state: "uploading" });
    void runOne({ ...row, state: "uploading" });
  };

  const retryReading = (row: UploadRow) => {
    if (!row.docId) return;
    patch(row.key, { state: "reading" });
    void walk(row.key, row.docId, true).catch(() => patch(row.key, { state: "error" }));
  };

  const forget = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  const clear = () => setRows([]);

  return { rows, start, cancel, retryUpload, retryReading, forget, clear };
}
