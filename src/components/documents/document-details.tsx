import { typeLabel } from "@/lib/document-labels";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { api } from "@/services/api";
import { Button } from "@/components/erad/button";
import { TextField } from "@/components/erad/text-field";
import { useDocumentActions } from "@/hooks/use-document-actions";
import { editState } from "@/services/document-actions";
import type { AppRole } from "@/services/document-rules";
import type { DocStatus } from "@/schemas/document";

interface Props {
  entityId: string;
  role: AppRole;
  doc: { id: string; name: string; description: string | null; status: DocStatus; expiry_date: string | null; document_type: string; legal_hold: boolean; hold_reason: string | null };
}

export function DocumentDetails({ entityId, role, doc }: Props) {
  const a = useDocumentActions(entityId, doc.id);
  const edit = editState(role, doc.status);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.name);
  const [description, setDescription] = useState(doc.description ?? "");
  const [expiry, setExpiry] = useState(doc.expiry_date ?? "");
  const retention = useQuery({ queryKey: ["document", doc.id, "retention"], queryFn: () => api.retentionFor(doc.id) });
  const day = (d: string) => format(new Date(d), "d MMM yyyy");
  const expires = doc.expiry_date
    ? doc.status === "expired" ? `Expired ${day(doc.expiry_date)}` : day(doc.expiry_date)
    : "No expiry date";

  if (!editing) {
    return (
      <section aria-label="Details" className="flex flex-col gap-3">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
          <dt className="type-label-12 text-text-secondary">Type</dt><dd className="type-label-14">{typeLabel(doc.document_type)}</dd>
          <dt className="type-label-12 text-text-secondary">Description</dt><dd className="type-label-14">{doc.description || "No description yet"}</dd>
          <dt className="type-label-12 text-text-secondary">Expires</dt><dd className="type-label-14">{expires}</dd>
          <dt className="type-label-12 text-text-secondary">Retention</dt>
          <dd className="type-label-14">
            {retention.isPending ? "Checking…" : retention.isError ? "Not available right now" : (
              <>
                {retention.data.policyName ?? "No retention policy"}
                {retention.data.keepUntil ? <><br />{`Keep until ${day(retention.data.keepUntil)}`}</> : null}
                {retention.data.why ? <span className="block text-text-secondary">{`(${retention.data.why})`}</span> : null}
              </>
            )}
          </dd>
          {doc.legal_hold ? (
            <>
              <dt className="type-label-12 text-text-secondary">Legal hold</dt>
              <dd className="type-label-14">{doc.hold_reason ?? "On hold"}</dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-col gap-1">
          <Button unavailable={!edit.available} onClick={() => setEditing(true)} className="self-start">Edit details</Button>
          {edit.reason ? <p className="type-label-12 text-text-secondary">{edit.reason}</p> : null}
        </div>
      </section>
    );
  }

  const invalid = !name.trim();
  return (
    <form
      aria-label="Edit details"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        a.updateDetails.mutate(
          { name: name.trim(), description, ...(expiry ? { expiryDate: expiry } : {}) },
          { onSuccess: () => setEditing(false) },
        );
      }}
    >
      <TextField label="Name" required value={name} maxLength={255} onChange={(e) => setName(e.target.value)} error={invalid ? "A name helps everyone find this document." : undefined} />
      <TextField label="Description" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      <TextField label="Expiry date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => setEditing(false)}>Cancel</Button>
        <Button type="submit" variant="primary" unavailable={invalid || a.updateDetails.isPending}>Save</Button>
      </div>
    </form>
  );
}
