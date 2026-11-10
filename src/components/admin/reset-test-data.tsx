import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { Card } from "@/components/erad/card";
import { api } from "@/services/api";

/** Group admin only: returns the prototype to its starting documents before a usability session. */
export function ResetTestData() {
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: () => api.resetTestData(),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast.success(`Test data reset. ${r.documentsRemoved} added documents and ${r.filesRemoved} files removed; ${r.documentsRemaining} starting documents remain.`);
    },
    onError: () => toast.error("The reset didn't finish. Nothing you see has changed. Try again in a moment."),
  });
  return (
    <Card title="Usability test">
      <div className="flex flex-col items-start gap-2">
        <p className="type-paragraph-14">Removes every document people added in the prototype, with its files, so the next session starts from the same documents.</p>
        <Button onClick={() => reset.mutate()} unavailable={reset.isPending}>
          <RotateCcw aria-hidden="true" />
          {reset.isPending ? "Resetting…" : "Reset test data"}
        </Button>
      </div>
    </Card>
  );
}
