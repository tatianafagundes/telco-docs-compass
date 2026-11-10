import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, CircleCheck, Info, ShieldAlert } from "lucide-react";
import { Button } from "@/components/erad/button";
import { Tag } from "@/components/erad/tag";
import { DocumentMenu } from "@/components/documents/document-menu";
import { BAND_TAG, fieldLabel, type ReviewField } from "@/services/review-rules";
import type { MatchResult } from "@/services/review-flow-rules";
import { cn } from "@/lib/utils";

const BAND_ICON = { high: CheckCircle2, medium: Info, low: AlertTriangle } as const;

export interface FieldRowProps {
  field: ReviewField & { reviewed_at?: string | null };
  /** Number shown on the page marker (page order, 1-based). */
  marker: number;
  selected: boolean;
  canReview: boolean;
  busy: boolean;
  editing: boolean;
  critical: boolean;
  match: MatchResult;
  reason: string;
  onSelect: () => void;
  onEditingChange: (editing: boolean) => void;
  onDecide: (decision: "accept" | "edit" | "reject", value?: string) => void;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "No value read";
  return String(v);
}

const DONE_WORD = { accepted: "Confirmed", edited: "Corrected", rejected: "Not in this document" } as const;

export function Marker({ n, active }: { n: number; active?: boolean }) {
  return (
    <span aria-hidden="true" className={cn("type-label-12 inline-flex size-5 shrink-0 items-center justify-center rounded-full border", active ? "border-focus bg-focus text-text-on-primary" : "border-border-input bg-layer-content text-text-secondary")}>
      {n}
    </span>
  );
}

export function FieldRow({ field, marker, selected, canReview, busy, editing, critical, match, reason, onSelect, onEditingChange, onDecide }: FieldRowProps) {
  const raw = field.value === null || field.value === undefined ? "" : String(field.value);
  const [draft, setDraft] = useState(raw);
  const [reopened, setReopened] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { if (field.status === "pending") setReopened(false); }, [field.status]);
  const label = fieldLabel(field.name);
  const checked = field.status !== "pending" && !reopened;

  if (checked && !editing) {
    return (
      <li role="option" id={`field-${field.id}`} aria-selected={selected} onClick={onSelect} className={cn("flex min-h-10 cursor-pointer items-center gap-2 border-b border-border-subtle px-3 py-2", selected && "bg-item-hover")}>
        <Marker n={marker} active={selected} />
        <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-status-cleared" />
        <span className="type-label-14 min-w-0 flex-1 break-words">
          {label}: <span className="type-paragraph-14">{show(field.value)}</span>
        </span>
        <span className="type-label-12 hidden text-text-secondary sm:inline">
          {DONE_WORD[field.status as keyof typeof DONE_WORD]}
          {field.reviewed_at ? ` · ${format(new Date(field.reviewed_at), "d MMM, HH:mm")}` : ""}
        </span>
        {canReview ? (
          <button type="button" className="focus-ring type-label-12 inline-flex min-h-6 items-center underline" onClick={(e) => { e.stopPropagation(); setReopened(true); onSelect(); }}>
            Change<span className="sr-only"> {label}</span>
          </button>
        ) : null}
      </li>
    );
  }

  const band = field.band ? BAND_TAG[field.band] : null;
  const Icon = field.band ? BAND_ICON[field.band] : null;
  return (
    <li
      role="option"
      id={`field-${field.id}`}
      aria-selected={selected}
      onClick={onSelect}
      className={cn("flex cursor-pointer flex-col gap-2 border-b border-border-subtle px-3 py-3", selected && "border-l-2 border-l-focus bg-item-hover")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Marker n={marker} active={selected} />
        <span className="type-label-14">{label}</span>
        {critical ? <Tag tone="indeterminate" small>Needed for approval</Tag> : null}
        <span className="ml-auto flex flex-wrap gap-1">
          {match === "differs" ? <Tag tone="major" small icon={<ShieldAlert aria-hidden="true" className="size-4" />}>Differs from record</Tag> : null}
          {match === "matches" ? <Tag tone="cleared" small>Matches record</Tag> : null}
          {match === null && band && Icon ? <Tag tone={band.tone} small icon={<Icon aria-hidden="true" className="size-4" />}>{band.label}</Tag> : null}
        </span>
      </div>
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); onDecide("edit", draft.trim()); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onEditingChange(false); }}
        >
          <label className="sr-only" htmlFor={`edit-${field.id}`}>Correct value for {label}</label>
          <input
            ref={inputRef}
            id={`edit-${field.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="type-paragraph-14 min-h-8 flex-1 border border-border-input bg-input px-2 text-text-main outline-none focus:border-focus"
          />
          <Button type="submit" variant="primary" unavailable={!draft.trim() || busy}>Save correction</Button>
          <Button onClick={() => onEditingChange(false)}>Cancel</Button>
        </form>
      ) : (
        <p className="type-title-16-medium break-words">{show(field.value)}</p>
      )}
      <p className="type-label-12 text-text-secondary">
        {reason}
        {field.source?.excerpt ? ` Read on page ${field.source.page ?? 1}: ‘${field.source.excerpt}’` : ""}
      </p>
      {!editing && canReview ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" unavailable={busy} onClick={(e) => { e.stopPropagation(); onDecide("accept"); }}>Confirm</Button>
          <Button unavailable={busy} onClick={(e) => { e.stopPropagation(); setDraft(raw); onEditingChange(true); }}>Correct</Button>
          <span onClick={(e) => e.stopPropagation()}>
            <DocumentMenu entries={[{ label: "Not in this document", onSelect: () => onDecide("reject") }]} />
          </span>
        </div>
      ) : null}
    </li>
  );
}
