// A document's processing, as the document panel shows it (file-hooks spec R5.1–R5.3): who a step
// waits for, what went wrong and what can be done. Delete stays in the panel's menu (managers).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { friendlyError } from "@/lib/document-labels";
import { processingView, waitingLine } from "@/lib/pipeline-copy";
import type { PipelineState } from "@/schemas/document";
import { api } from "@/services/api";
import { can, type AppRole } from "@/services/document-rules";
import { EXTERNAL_RESULT_TIMEOUT_MINUTES } from "@/services/file-hook-timeouts";

export function ProcessingNotice({
  doc,
  entityId,
  role,
  onDone,
}: {
  doc: { id: string; pipeline_state: PipelineState; pipeline_detail?: unknown };
  entityId: string;
  role: AppRole;
  /** After an action: the notice may go away, so the panel puts focus back (design review S5). */
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  // The panel has room for the whole system name (design review S8).
  const view = processingView(doc.pipeline_state, doc.pipeline_detail, { nameChars: 80 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["document", doc.id] });
    if (entityId) void qc.invalidateQueries({ queryKey: ["documents", { entityId }] });
  };
  const act = useMutation({
    mutationFn: async (a: "retry" | "keepUnread" | "report") => {
      if (a === "retry") await api.advancePipeline({ id: doc.id, retry: true });
      else if (a === "keepUnread")
        await api.updateMetadata({ id: doc.id, patch: { keepUnread: true } });
      else await api.reportProblem({ id: doc.id, kind: "security", reason: "threat" });
      return a;
    },
    onSuccess: (a) => {
      toast.success(
        a === "retry"
          ? "Trying again."
          : a === "keepUnread"
            ? "Kept. Not read, so enter the details by hand."
            : "Reported to security. They will contact you if they need more.",
      );
      refresh();
      if (onDone) requestAnimationFrame(onDone);
    },
    onError: (e) => toast.error(friendlyError(e instanceof Error ? e.message : undefined)),
  });
  if (!view.waiting && !view.message) return null;
  // As the server allows: reporting needs review rights, the steps need edit rights.
  const buttons = view.actions.filter(
    (a): a is "retry" | "keepUnread" | "report" =>
      a !== "delete" && can(role, a === "report" ? "review" : "edit"),
  );
  // What the person cannot do here, and where Delete is (design review S6).
  const whoCan = [
    view.actions.includes("retry") && !can(role, "edit") ? "An editor can try again." : null,
    view.actions.includes("delete")
      ? can(role, "manage")
        ? "Delete is in the menu above."
        : "A manager can delete this file."
      : null,
  ].filter((x): x is string => x !== null);
  return (
    <div className="flex flex-col gap-2">
      {view.waiting ? (
        <p className="type-label-12 text-text-secondary">
          {waitingLine(view.waiting)}. If it doesn't answer within {EXTERNAL_RESULT_TIMEOUT_MINUTES}{" "}
          minutes, the file fails and can be tried again.
        </p>
      ) : null}
      {view.message ? <p className="type-paragraph-14">{view.message}</p> : null}
      {buttons.length ? (
        <div className="flex flex-wrap gap-2">
          {buttons.map((a) => (
            <Button key={a} unavailable={act.isPending} onClick={() => act.mutate(a)}>
              {act.isPending && act.variables === a
                ? a === "retry"
                  ? "Trying again…"
                  : a === "keepUnread"
                    ? "Keeping…"
                    : "Reporting…"
                : a === "retry"
                  ? "Try again"
                  : a === "keepUnread"
                    ? "Keep without reading"
                    : "Report a problem"}
            </Button>
          ))}
        </div>
      ) : null}
      {whoCan.length ? (
        <p className="type-label-12 text-text-secondary">{whoCan.join(" ")}</p>
      ) : null}
    </div>
  );
}
