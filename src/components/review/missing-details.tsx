// Required details that nobody could read from the file. There is no row to confirm, so the reviewer
// enters each one from the document, and approval can go ahead. Knows nothing about the server: the
// page passes `onSave`.
import { useState } from "react";
import { Button } from "@/components/erad/button";
import { TextField } from "@/components/erad/text-field";
import { friendlyError } from "@/lib/document-labels";
import { SeamFailure } from "@/services/api";
import { fieldLabel } from "@/services/review-rules";

export interface MissingDetailsProps {
  names: string[];
  /** False for someone who may read but not review: they see what is missing, not the fields. */
  canEnter: boolean;
  onSave: (name: string, value: string) => Promise<unknown>;
}

export function MissingDetails({ names, canEnter, onSave }: MissingDetailsProps) {
  if (names.length === 0) return null;
  return (
    <section
      aria-labelledby="missing-details-title"
      className="flex flex-col gap-3 border border-border-item p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="missing-details-title" className="type-title-16-medium">
          Required details not read
        </h2>
        <p className="type-paragraph-14">
          {canEnter
            ? "This document type needs these details, but none could be read from the file. Enter each one from the document. Approval waits until they are entered."
            : `Approval waits until a reviewer enters: ${names.map(fieldLabel).join(", ")}.`}
        </p>
      </div>
      {canEnter
        ? names.map((name) => <DetailEntry key={name} name={name} onSave={onSave} />)
        : null}
    </section>
  );
}

function DetailEntry({
  name,
  onSave,
}: {
  name: string;
  onSave: (name: string, value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim()) {
      setError("Enter a value.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(name, value.trim());
    } catch (e) {
      setError(friendlyError(e instanceof SeamFailure ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextField
        className="min-w-0 flex-1"
        label={fieldLabel(name)}
        value={value}
        maxLength={500}
        autoComplete="off"
        error={error ?? undefined}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
      />
      <Button type="submit" unavailable={busy}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
