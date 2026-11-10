import { useState } from "react";
import { Button } from "@/components/erad/button";
import { Dialog } from "@/components/erad/dialog";
import { useDocumentActions } from "@/hooks/use-document-actions";
import { deleteState, manageState, nextStep, sendBackState } from "@/services/document-actions";
import type { AppRole } from "@/services/document-rules";
import type { DocStatus } from "@/schemas/document";

interface Props {
  entityId: string;
  doc: { id: string; status: DocStatus; legal_hold: boolean; retain_until: string | null; name: string };
  role: AppRole;
}

type Open = null | "sendBack" | "report" | "hold" | "delete";

const textAreaClass =
  "type-paragraph-14 min-h-20 w-full border border-border-input bg-input p-2 text-text-main outline-none focus:border-focus";

function Reason({ text }: { text?: string | undefined }) {
  return text ? <p className="type-label-12 text-text-secondary">{text}</p> : null;
}

export function DocumentActionsBar({ entityId, doc, role }: Props) {
  const a = useDocumentActions(entityId, doc.id);
  const [open, setOpen] = useState<Open>(null);
  const [note, setNote] = useState("");
  const close = () => { setOpen(null); setNote(""); };

  const next = nextStep(role, doc.status);
  const back = sendBackState(role, doc.status);
  const manage = manageState(role);
  const del = deleteState(role, doc.legal_hold, doc.retain_until, new Date().toISOString().slice(0, 10));
  const busy = a.transition.isPending || a.reportProblem.isPending || a.setHold.isPending || a.remove.isPending;

  return (
    <section aria-label="Actions" className="flex flex-col gap-3">
      {next ? (
        <div className="flex flex-col gap-1">
          <Button variant="primary" unavailable={!next.available || busy} onClick={() => a.transition.mutate({ to: next.to })}>
            {next.label}
          </Button>
          <Reason text={next.reason} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {back ? <Button unavailable={!back.available} onClick={() => setOpen("sendBack")}>Send back</Button> : null}
        <Button variant="ghost" onClick={() => setOpen("report")}>Report a problem</Button>
      </div>
      {back ? <Reason text={back.reason} /> : null}

      <details className="border-t border-border-subtle pt-3">
        <summary className="type-label-14 focus-ring cursor-pointer text-text-secondary">More</summary>
        <div className="mt-3 flex flex-col gap-2">
          <Button unavailable={!manage.available} onClick={() => (doc.legal_hold ? a.setHold.mutate({ active: false }) : setOpen("hold"))}>
            {doc.legal_hold ? "Release legal hold" : "Set legal hold"}
          </Button>
          <Reason text={manage.reason} />
          <Button variant="destructive" unavailable={!del.available} onClick={() => setOpen("delete")}>Delete document</Button>
          {manage.available ? <Reason text={del.reason} /> : null}
        </div>
      </details>

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
        title="Set legal hold"
        description="While on hold, this document can't be deleted, whatever its keep-until date."
        actions={<>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" unavailable={!note.trim()} onClick={() => { a.setHold.mutate({ active: true, reason: note.trim() }); close(); }}>Set hold</Button>
        </>}
      >
        <label className="type-label-14 flex flex-col gap-1">Reason or case reference
          <textarea className={textAreaClass} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {!note.trim() ? <Reason text="A reason is needed so others know why the hold exists." /> : null}
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
  );
}
