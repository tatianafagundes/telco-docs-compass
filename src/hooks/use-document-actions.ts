import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, SeamFailure } from "@/services/api";
import { friendlyError } from "@/lib/document-labels";
import type { DocStatus } from "@/schemas/document";

/** One hook per document: every action refreshes the record list and the document view. */
export function useDocumentActions(entityId: string, docId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["documents", { entityId }] });
    void qc.invalidateQueries({ queryKey: ["document", docId] });
  };
  const onError = (e: unknown) => {
    toast.error(friendlyError(e instanceof SeamFailure ? e.code : undefined));
    refresh();
  };

  const updateDetails = useMutation({
    mutationFn: (patch: { name?: string; description?: string; expiryDate?: string }) => api.updateMetadata({ id: docId, patch }),
    onSuccess: () => { toast.success("Details saved"); refresh(); },
    onError,
  });
  const transition = useMutation({
    mutationFn: (v: { to: DocStatus; comment?: string }) => api.transition({ id: docId, ...v }),
    onSuccess: () => { toast.success("Status updated"); refresh(); },
    onError,
  });
  const reportProblem = useMutation({
    mutationFn: (v: { kind: "security" | "unreadable" | "sendBack"; reason: "threat" | "wrongDocument" | "wrongEntity" | "unreadablePages" | "other"; comment?: string }) =>
      api.reportProblem({ id: docId, ...v }),
    onSuccess: (_d, v) => { toast.success(v.kind === "sendBack" ? "Sent back to draft" : "Thanks, we've noted the problem"); refresh(); },
    onError,
  });
  const setHold = useMutation({
    mutationFn: (v: { active: boolean; reason?: string }) => api.setHold({ id: docId, ...v }),
    onSuccess: (_d, v) => { toast.success(v.active ? "Legal hold set" : "Legal hold released"); refresh(); },
    onError,
  });
  const restore = useMutation({
    mutationFn: () => api.restoreDeleted({ id: docId }),
    onSuccess: () => { toast.success("Document restored"); refresh(); },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete({ id: docId }),
    onSuccess: () => {
      refresh();
      toast.success("Document deleted", { action: { label: "Undo", onClick: () => restore.mutate() } });
    },
    onError,
  });

  return { updateDetails, transition, reportProblem, setHold, remove, restore };
}
