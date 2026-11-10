import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { UploadDialog } from "@/components/upload/upload-dialog";
import { UploadProgress } from "@/components/upload/upload-progress";
import type { useUpload } from "@/hooks/use-upload";
import { api } from "@/services/api";
import { can, type AppRole } from "@/services/document-rules";
import { shortEntityId, type UploadSpec } from "@/services/upload-rules";
import { friendlyError } from "@/lib/document-labels";

const specsQuery = {
  queryKey: ["specifications"],
  queryFn: async (): Promise<UploadSpec[]> =>
    (await api.listSpecifications()).map((s) => {
      const def = (s.definition ?? {}) as { acceptedMimeTypes?: string[]; maxSizeMb?: number; specCharacteristic?: { name: string; required?: boolean }[] };
      return {
        code: s.code,
        name: s.name,
        acceptedMimeTypes: def.acceptedMimeTypes ?? [],
        maxSizeMb: def.maxSizeMb ?? null,
        requiredFields: (def.specCharacteristic ?? []).filter((c) => c.required).map((c) => c.name),
      };
    }),
};

export interface AddDocumentsProps {
  entityId: string;
  entityKind: string;
  role: AppRole;
  existing: { id: string; name: string }[];
  upload: ReturnType<typeof useUpload>;
  onShowAttention: () => void;
  /** The Documents tab content; becomes the drop zone. */
  children: ReactNode;
}

/** "Add documents": button, drag-and-drop on the tab and paste, all opening the same dialog. */
export function AddDocuments({ entityId, entityKind, role, existing, upload, onShowAttention, children }: AddDocumentsProps) {
  const allowed = can(role, "edit");
  const canDelete = can(role, "manage");
  const specs = useQuery(specsQuery);
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const offer = (list: FileList | File[] | null | undefined) => {
    const arr = Array.from(list ?? []);
    if (arr.length === 0) return;
    if (!allowed) {
      toast("Viewers can open documents here. Ask a contributor to add files.");
      return;
    }
    setFiles(arr);
  };

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) offer(e.clipboardData.files);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  const act = (fn: () => Promise<unknown>, done: string) =>
    void fn().then(() => toast.success(done), (e: unknown) => toast.error(friendlyError(e instanceof Error ? e.message : undefined)));

  return (
    <div
      className="relative flex flex-col gap-4"
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) setDragging(true); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        (e.nativeEvent as DragEvent & { eradHandled?: boolean }).eradHandled = true;
        setDragging(false);
        offer(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-col items-start gap-1">
        <Button variant="primary" unavailable={!allowed} aria-describedby={!allowed ? "add-docs-reason" : undefined} onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" />
          Add documents
        </Button>
        {!allowed ? <p id="add-docs-reason" className="type-label-12 text-text-secondary">Viewers can open documents here but can't add them.</p> : null}
        <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { offer(e.target.files); e.target.value = ""; }} />
      </div>
      {children}
      {dragging && allowed ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-focus bg-layer-content/90">
          <span className="type-title-18-medium">Drop to add to {shortEntityId(entityId)}</span>
        </div>
      ) : null}
      <UploadDialog
        open={files.length > 0}
        files={files}
        specs={specs.data ?? []}
        entityKind={entityKind}
        existing={existing}
        onCancel={() => setFiles([])}
        onConfirm={(planned) => { setFiles([]); upload.start(planned); }}
      />
      <UploadProgress
        rows={upload.rows}
        canDelete={canDelete}
        onCancel={upload.cancel}
        onRetryUpload={upload.retryUpload}
        onRetryReading={upload.retryReading}
        onKeepUnread={(r) => r.docId && act(async () => { await api.updateMetadata({ id: r.docId as string, patch: { keepUnread: true } }); upload.forget(r.key); }, "Kept. Not read, so enter the details by hand.")}
        onReportSecurity={(r) => r.docId && act(() => api.reportProblem({ id: r.docId as string, kind: "security", reason: "threat" }), "Reported to security. They will contact you if they need more.")}
        onDelete={(r) => r.docId && act(async () => { await api.delete({ id: r.docId as string }); upload.forget(r.key); }, "Deleted. You can restore it from deletion history.")}
        onShowAttention={onShowAttention}
        onDismiss={upload.clear}
      />
    </div>
  );
}
