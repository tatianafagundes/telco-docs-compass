import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/erad/button";
import { Tag } from "@/components/erad/tag";
import { Tooltip } from "@/components/erad/tooltip";
import { BAND_TAG, editedNote, fieldLabel, STATUS_WORD, type ReviewField } from "@/services/review-rules";
import { cn } from "@/lib/utils";

const BAND_ICON = { high: CheckCircle2, medium: Info, low: AlertTriangle } as const;

export interface FieldRowProps {
  field: ReviewField;
  index: number;
  selected: boolean;
  canReview: boolean;
  busy: boolean;
  editing: boolean;
  onSelect: () => void;
  onEditingChange: (editing: boolean) => void;
  onDecide: (decision: "accept" | "edit" | "reject", value?: string) => void;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "No value read";
  return String(v);
}

export function FieldRow({ field, index, selected, canReview, busy, editing, onSelect, onEditingChange, onDecide }: FieldRowProps) {
  const raw = field.value === null || field.value === undefined ? "" : String(field.value);
  const [draft, setDraft] = useState(raw);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  const band = field.band ? BAND_TAG[field.band] : null;
  const Icon = field.band ? BAND_ICON[field.band] : null;
  const note = editedNote(field);
  const label = fieldLabel(field.name);

  return (
    <li
      role="option"
      id={`field-${field.id}`}
      aria-selected={selected}
      onClick={onSelect}
      className={cn("flex min-h-12 cursor-pointer flex-col gap-1 border-b border-border-subtle px-3 py-2", selected && "border-l-2 border-l-focus bg-item-hover")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="type-label-14">[{index + 1}] {label}</span>
        <span className="flex flex-wrap gap-1">
          {band && Icon ? (
            <Tooltip content={field.confidence !== null ? `Score ${Math.round(field.confidence * 100)} %` : "No score"}>
              <span tabIndex={-1}><Tag tone={band.tone} small icon={<Icon aria-hidden="true" className="size-4" />}>{band.label}</Tag></span>
            </Tooltip>
          ) : null}
          <span className="type-label-12 text-text-secondary">{STATUS_WORD[field.status]}</span>
        </span>
      </div>
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); onDecide("edit", draft.trim()); }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onEditingChange(false); } }}
        >
          <label className="sr-only" htmlFor={`edit-${field.id}`}>{label}</label>
          <input
            ref={inputRef}
            id={`edit-${field.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="type-paragraph-14 min-h-8 flex-1 border border-border-input bg-input px-2 text-text-main outline-none focus:border-focus"
          />
          <Button type="submit" variant="primary" unavailable={!draft.trim() || busy}>Save</Button>
          <Button onClick={() => onEditingChange(false)}>Cancel</Button>
        </form>
      ) : (
        <p className="type-paragraph-14 break-words">{show(field.value)}</p>
      )}
      {note ? <p className="type-label-12 text-text-secondary">{note}</p> : null}
      {field.status === "pending" && field.source?.excerpt ? (
        <p className="type-label-12 text-text-secondary">Read from page {field.source.page ?? 1}: ‘{field.source.excerpt}’</p>
      ) : null}
      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <Button unavailable={!canReview || busy} onClick={(e) => { e.stopPropagation(); onDecide("accept"); }}>Accept</Button>
          <Button unavailable={!canReview || busy} onClick={(e) => { e.stopPropagation(); setDraft(raw); onEditingChange(true); }}>Edit</Button>
          <Button unavailable={!canReview || busy} onClick={(e) => { e.stopPropagation(); onDecide("reject"); }}>Reject</Button>
        </div>
      ) : null}
    </li>
  );
}
