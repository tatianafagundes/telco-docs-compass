import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/erad/dialog";
import { Button } from "@/components/erad/button";
import { Select } from "@/components/erad/select";
import {
  blocksAdding,
  defaultType,
  fileIssues,
  formatSize,
  middleTruncate,
  type UploadSpec,
} from "@/services/upload-rules";
import type { PlannedFile } from "@/hooks/use-upload";

export interface UploadDialogProps {
  open: boolean;
  files: File[];
  specs: UploadSpec[];
  entityKind: string;
  existing: { id: string; name: string }[];
  onCancel: () => void;
  onConfirm: (planned: PlannedFile[]) => void;
}

interface Draft {
  key: string;
  file: File;
  type: string | null;
  reason: string;
}

export function UploadDialog({ open, files, specs, entityKind, existing, onCancel, onConfirm }: UploadDialogProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  useEffect(() => {
    setDrafts(
      files.map((file) => {
        const d = defaultType(entityKind, file.name, specs);
        return { key: crypto.randomUUID(), file, type: d.code, reason: d.reason };
      }),
    );
  }, [files, specs, entityKind]);

  const typeOptions = useMemo(
    () => [{ options: specs.filter((s) => s.requiredFields.length === 0).map((s) => ({ value: s.code, label: s.name })) }],
    [specs],
  );
  const checked = drafts.map((d) => ({
    ...d,
    issues: fileIssues({ name: d.file.name, size: d.file.size, mimeType: d.file.type }, specs.find((s) => s.code === d.type), existing),
  }));
  const addable = checked.filter((d) => d.type && !blocksAdding(d.issues));
  const n = addable.length;
  const skipped = checked.length - n;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (!o ? onCancel() : undefined)}
      title={files.length === 1 ? "Add 1 document" : `Add ${files.length} documents`}
      description="Prototype: do not add real customer files."
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            unavailable={n === 0}
            aria-describedby={n === 0 ? "upload-none-reason" : undefined}
            onClick={() => onConfirm(addable.map((d) => ({ key: d.key, file: d.file, documentType: d.type as string })))}
          >
            {n === 1 ? "Add 1 document" : `Add ${n} documents`}
          </Button>
        </>
      }
    >
      <ul className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
        {checked.map((d) => (
          <li key={d.key} className="flex flex-col gap-2 border-b border-border-subtle pb-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-label-14 min-w-0" title={d.file.name}>{middleTruncate(d.file.name, 44)}</span>
              <span className="type-label-12 shrink-0 text-text-secondary">{formatSize(d.file.size)}</span>
            </div>
            <Select
              label="Document type"
              groups={typeOptions}
              {...(d.type ? { value: d.type } : {})}
              placeholder="Choose a type"
              onValueChange={(v) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, type: v, reason: "Chosen by you" } : x)))}
            />
            <p className="type-label-12 text-text-secondary">{d.reason}</p>
            {d.issues.map((i) => (
              <p key={i.kind} className="type-label-12 flex items-start gap-1 text-text-main" role={i.kind === "duplicate" ? undefined : "alert"}>
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-major" />
                <span>
                  {i.message}
                  {i.kind === "duplicate" ? " It will be added as a separate document. To add a new version instead, open that document." : null}
                </span>
              </p>
            ))}
          </li>
        ))}
      </ul>
      {n === 0 ? (
        <p id="upload-none-reason" className="type-label-12 text-text-secondary">None of these files can be added yet. Choose another type or another file.</p>
      ) : skipped > 0 ? (
        <p className="type-label-12 text-text-secondary">{skipped === 1 ? "1 file will be left out" : `${skipped} files will be left out`} until its issue is solved.</p>
      ) : null}
    </Dialog>
  );
}
