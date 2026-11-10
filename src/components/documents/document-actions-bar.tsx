import { useState } from "react";
import { Button } from "@/components/erad/button";
import { Dialog } from "@/components/erad/dialog";
import { useDocumentActions } from "@/hooks/use-document-actions";
import { deleteState, manageState, nextStep, purgeState, sendBackState } from "@/services/document-actions";
import { TextField } from "@/components/erad/text-field";
import type { AppRole } from "@/services/document-rules";
import type { ApproveGate } from "@/services/review-rules";
import { Link } from "@tanstack/react-router";
import type { DocStatus } from "@/schemas/document";
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { AUTHOR_APPROVE_REASON } from "@/services/review-flow-rules";
import { DocumentMenu, type MenuEntry } from "@/components/documents/document-menu";

interface Props {
  entityId: string;
  doc: { id: string; status: DocStatus; legal_hold: boolean; retain_until: string | null; name: string };
  role: AppRole;
  /** Required details still to check before Approve. */
  approveGate?: ApproveGate;
  /** The signed-in person added this document (four-eyes). */
  own?: boolean;
  /** Title block shown left of the "…" menu. */
  header: ReactNode;
  /** Extra menu entries supplied by the panel (access, explanation). */
  extraMenu: MenuEntry[];
}

type Open = null | "sendBack" | "report" | "hold" | "release" | "delete" | "purge";

const textAreaClass =
  "type-paragraph-14 min-h-20 w-full border border-border-input bg-input p-2 text-text-main outline-none focus:border-focus";

function Reason({ text }: { text?: string | undefined }) {
  return text ? <p className="type-label-12 text-text-secondary">{text}</p> : null;
}

export function DocumentActionsBar({ entityId, doc, role, approveGate, own = false, header, extraMenu }: Props) {
  const a = useDocumentActions(entityId, doc.id);
  const [open, setOpen] = useState<Open>(null);
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const close = () => { setOpen(null); setNote(""); setReference(""); };

  const step = nextStep(role, doc.status);
  const gated = step?.to === "approved" && step.available && approveGate?.reason;
  const authorBlocked = step?.to === "approved" && step.available && !gated && own;
  const next = step && gated ? { ...step, available: false, reason: approveGate?.reason } : step && authorBlocked ? { ...step, available: false, reason: AUTHOR_APPROVE_REASON } : step;
  const back = sendBackState(role, doc.status);
  const manage = manageState(role);
  const todayIso = new Date().toISOString().slice(0, 10);
  const del = deleteState(role, doc.legal_hold, doc.retain_until, todayIso);
  const purge = purgeState(role, doc.legal_hold, doc.retain_until, todayIso);
  const isAdmin = role === "tenant_admin" || role === "master_admin";
  const busy = a.transition.isPending || a.reportProblem.isPending || a.setHold.isPending || a.remove.isPending || a.purge.isPending;

  const menu: MenuEntry[] = [
    ...extraMenu,
    { label: "Report a problem", onSelect: () => setOpen("report") },
    { label: doc.legal_hold ? "Release legal hold" : "Place legal hold", onSelect: () => setOpen(doc.legal_hold ? "release" : "hold"), reason: manage.reason, separatorBefore: true },
    { label: "Delete document", onSelect: () => setOpen("delete"), reason: del.available ? undefined : (manage.available ? del.reason : manage.reason) },
    ...(isAdmin ? [{ label: "Delete permanently", onSelect: () => setOpen("purge"), reason: purge.reason, destructive: true }] : []),
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-2">{header}</div>
        <DocumentMenu entries={menu} />
      </div>
    <section aria-label="Next step" className="flex flex-col gap-3">
      {next ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button variant="primary" className="self-start" unavailable={!next.available || busy} onClick={() => a.transition.mutate({ to: next.to })}>
              {!next.available ? <Lock aria-hidden="true" /> : null}
              {next.label}
            </Button>
            {next.reason ? <span className="type-label-12 text-text-secondary">{next.reason}</span> : null}
          </div>
          {gated ? (
            <Link to="/records/$entityId/review/$docId" params={{ entityId, docId: doc.id }} className="focus-ring type-label-12 inline-flex min-h-6 items-center self-start underline">Check details</Link>
          ) : null}
        </div>
      ) : null}
      {back ? (
        <div className="flex flex-col gap-1">
          <Button className="self-start" unavailable={!back.available} onClick={() => setOpen("sendBack")}>Send back</Button>
          <Reason text={back.reason} />
        </div>
      ) : null}

      <Dialog
        open={open === "sendBack"}
        onOpenChange={(o) => (o ? null : close())}
        title="Send back to draft"
        description="The author can then correct it and send it for review again. A short note helps them."
        actions={<>
          <Button onClick={close}>Keep in review</Button>
          <Button variant="primary" onClick={() => { a.reportProblem.mutate({ kind: "sendBack", reason: "other", ...(note ? { comment: note } : {}) }); close(); }}>Send back</Button>
        </>}
      >
        <label className="type-label-14 flex flex-col gap-1">Note for the author (optional)
          <textarea className={textAreaClass} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Dialog>

      <Dialog
        open={open === "report"}
        onOpenChange={(o) => (o ? null : close())}
        title="Report a problem"
        description="Tell us what's wrong and we'll make sure the right person takes a look."
        actions={<>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => { a.reportProblem.mutate({ kind: "unreadable", reason: "other", ...(note ? { comment: note } : {}) }); close(); }}>Send report</Button>
        </>}
      >
        <label className="type-label-14 flex flex-col gap-1">What did you notice?
          <textarea className={textAreaClass} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Dialog>

      <Dialog
        open={open === "hold"}
        onOpenChange={(o) => (o ? null : close())}
        title="Place legal hold"
        description="This blocks permanent deletion and keeps every version until the hold is released. Editing and restoring versions stay allowed."
        actions={<>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" unavailable={!note.trim()} onClick={() => { a.setHold.mutate({ active: true, reason: note.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) }); close(); }}>Place hold</Button>
        </>}
      >
        <label className="type-label-14 flex flex-col gap-1">Reason
          <textarea className={textAreaClass} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {!note.trim() ? <Reason text="A reason is needed so others know why the hold exists." /> : null}
        <TextField label="Reference (optional)" maxLength={40} value={reference} onChange={(e) => setReference(e.target.value)} helper="For example a case or dispute number." />
      </Dialog>

      <Dialog
        open={open === "release"}
        onOpenChange={(o) => (o ? null : close())}
        title="Release legal hold"
        description="The document then follows its normal retention again and can be deleted once its keep-until date has passed."
        actions={<>
          <Button onClick={close}>Keep the hold</Button>
          <Button variant="primary" unavailable={!note.trim()} onClick={() => { a.setHold.mutate({ active: false, reason: note.trim() }); close(); }}>Release hold</Button>
        </>}
      >
        <label className="type-label-14 flex flex-col gap-1">Reason for release
          <textarea className={textAreaClass} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {!note.trim() ? <Reason text="A reason is needed so the history explains the release." /> : null}
      </Dialog>

      <Dialog
        open={open === "purge"}
        onOpenChange={(o) => (o ? null : close())}
        title={`Delete "${doc.name}" permanently`}
        description="Its stored files and extracted details are removed for good. It can't be restored. The activity history stays."
        actions={<>
          <Button onClick={close}>Keep document</Button>
          <Button variant="destructive" unavailable={!note.trim()} onClick={() => { a.purge.mutate(note.trim()); close(); }}>Delete permanently</Button>
        </>}
      >
        <label className="type-label-14 flex flex-col gap-1">Reason
          <textarea className={textAreaClass} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Dialog>

      <Dialog
        open={open === "delete"}
        onOpenChange={(o) => (o ? null : close())}
        title={`Delete "${doc.name}"?`}
        description="It leaves this record straight away. You can undo right after, and an administrator can restore it later."
        actions={<>
          <Button onClick={close}>Keep document</Button>
          <Button variant="destructive" onClick={() => { a.remove.mutate(); close(); }}>Delete</Button>
        </>}
      />
    </section>
    </>
  );
}
