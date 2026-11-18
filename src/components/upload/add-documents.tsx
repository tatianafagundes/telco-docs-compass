import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { UploadDialog } from "@/components/upload/upload-dialog";
import { UploadProgress } from "@/components/upload/upload-progress";
import { takeFiles } from "@/components/upload/upload-handoff";
import { Link } from "@tanstack/react-router";
import type { useUpload } from "@/hooks/use-upload";
import { api } from "@/services/api";
import { can, type AppRole } from "@/services/document-rules";
import { addDocumentsState } from "@/services/document-actions";
import { shortEntityId, type UploadSpec } from "@/services/upload-rules";
import { friendlyError } from "@/lib/document-labels";

const specsQuery = {
  queryKey: ["specifications"],
  queryFn: async (): Promise<UploadSpec[]> =>
    (await api.listSpecifications()).map((s) => {
      const def = (s.definition ?? {}) as {
        acceptedMimeTypes?: string[];
        maxSizeMb?: number;
        specCharacteristic?: { name: string; required?: boolean }[];
      };
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
  /** Set when the person came here to add documents (from the Documents page): the record's name. */
  arrivingFor?: string | null;
  /** The record's name, so the type step says where the files go. */
  recordName?: string;
}

/** "Add documents": button, drag-and-drop on the tab and paste, all opening the same dialog. */
export function AddDocuments({
  entityId,
  entityKind,
  role,
  existing,
  upload,
  onShowAttention,
  children,
  arrivingFor = null,
  recordName,
}: AddDocumentsProps) {
  const state = addDocumentsState(role);
  const allowed = state.available;
  const button = useRef<HTMLButtonElement>(null);
  // Shown once on arrival, until the person picks or drops files; it says where the files will go.
  const [hint, setHint] = useState<string | null>(arrivingFor);
  useEffect(() => {
    if (!arrivingFor) return;
    // Files chosen on the Documents page go straight to the type step; otherwise offer the button.
    const handed = allowed ? takeFiles(entityId) : [];
    if (handed.length) {
      setHint(null);
      setFiles(handed);
    } else button.current?.focus();
  }, [arrivingFor, entityId, allowed]);
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
    setHint(null);
    setFiles(arr);
  };

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) offer(e.clipboardData.files);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  const qc = useQueryClient();
  const act = (fn: () => Promise<unknown>, done: string) =>
    void fn().then(
      () => {
        toast.success(done);
        void qc.invalidateQueries({ queryKey: ["documents", { entityId }] });
      },
      (e: unknown) => toast.error(friendlyError(e instanceof Error ? e.message : undefined)),
    );

  return (
    <div
      className="relative flex flex-col gap-4"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        (e.nativeEvent as DragEvent & { eradHandled?: boolean }).eradHandled = true;
        setDragging(false);
        offer(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-col items-start gap-1">
        <Button
          ref={button}
          variant="primary"
          unavailable={!allowed}
          aria-describedby={!allowed ? "add-docs-reason" : hint ? "add-docs-hint" : undefined}
          onClick={() => {
            setHint(null);
            input.current?.click();
          }}
        >
          <Upload aria-hidden="true" />
          Add documents
        </Button>
        {!allowed ? (
          <p id="add-docs-reason" className="type-label-12 text-text-secondary">
            {state.reason}
          </p>
        ) : hint ? (
          <p id="add-docs-hint" className="type-label-12 text-text-secondary">
            Adding to {hint}. Choose Add documents to pick files, or drop them into the list.{" "}
            <Link
              to="/documents"
              search={{ choose: true }}
              className="focus-ring inline-flex min-h-6 items-center underline"
            >
              Choose a different record
            </Link>
          </p>
        ) : null}
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            offer(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {children}
      {dragging && allowed ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-focus bg-layer-content/90"
        >
          <span className="type-title-18-medium">Drop to add to {shortEntityId(entityId)}</span>
        </div>
      ) : null}
      <UploadDialog
        open={files.length > 0}
        files={files}
        specs={specs.data ?? []}
        entityKind={entityKind}
        target={recordName}
        existing={existing}
        onCancel={() => {
          setFiles([]);
          // Nothing opened this dialog when the files were handed over: come back to the button,
          // and to the hint that can take the person to another record.
          setHint(arrivingFor);
          requestAnimationFrame(() => button.current?.focus());
        }}
        onConfirm={(planned) => {
          setFiles([]);
          upload.start(planned);
        }}
      />
      <UploadProgress
        rows={upload.rows}
        canDelete={canDelete}
        onCancel={upload.cancel}
        onRetryUpload={upload.retryUpload}
        onRetryReading={upload.retryReading}
        onKeepUnread={(r) =>
          r.docId &&
          act(async () => {
            await api.updateMetadata({ id: r.docId as string, patch: { keepUnread: true } });
            upload.forget(r.key);
          }, "Kept. Not read, so enter the details by hand.")
        }
        onReportSecurity={(r) =>
          r.docId &&
          act(
            () => api.reportProblem({ id: r.docId as string, kind: "security", reason: "threat" }),
            "Reported to security. They will contact you if they need more.",
          )
        }
        onDelete={(r) =>
          r.docId &&
          act(async () => {
            await api.delete({ id: r.docId as string });
            upload.forget(r.key);
          }, "Deleted. You can restore it from deletion history.")
        }
        onShowAttention={onShowAttention}
        onDismiss={upload.clear}
      />
    </div>
  );
}
