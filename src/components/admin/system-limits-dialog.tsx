import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { Dialog } from "@/components/erad/dialog";
import { TextField } from "@/components/erad/text-field";
import { failureText } from "@/hooks/use-config";
import { api } from "@/services/api";
import type { ConnectedSystem } from "@/services/integration-clients.functions";
import { LIMIT_BOUNDS, isValidLimit } from "@/services/rate-limit-rules";

export function SystemLimitsDialog({ system, onClose, onSaved }: { system: ConnectedSystem | null; onClose: () => void; onSaved: () => void }) {
  const [read, setRead] = useState("");
  const [write, setWrite] = useState("");
  useEffect(() => {
    if (system) {
      setRead(String(system.readLimitPerMinute));
      setWrite(String(system.writeLimitPerMinute));
    }
  }, [system]);
  const save = useMutation({
    mutationFn: () => api.updateSystemLimits({ id: system?.id ?? "", readLimitPerMinute: Number(read), writeLimitPerMinute: Number(write) }),
    onSuccess: () => {
      toast.success("Request limits saved. They apply from the next request.");
      onSaved();
    },
    onError: (e) => toast.error(failureText(e)),
  });
  const readError = isValidLimit("read", Number(read)) ? undefined : `Choose a whole number from ${LIMIT_BOUNDS.read.min} to ${LIMIT_BOUNDS.read.max}.`;
  const writeError = isValidLimit("write", Number(write)) ? undefined : `Choose a whole number from ${LIMIT_BOUNDS.write.min} to ${LIMIT_BOUNDS.write.max}.`;
  const reason = readError || writeError ? "Both limits need a valid number." : null;
  return (
    <Dialog
      open={system !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Request limits for ${system?.name ?? ""}`}
      description="Each system has its own allowance per minute, so a busy system never slows down the others. Requests over the limit get a clear 'try again in' reply."
      actions={
        <>
          {reason ? <span className="type-paragraph-14 text-text-secondary">{reason}</span> : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" unavailable={reason !== null || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save limits"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Reads per minute" inputMode="numeric" value={read} onChange={(e) => setRead(e.target.value.trim())} error={readError} helper="Looking up and downloading documents. Usual setting: 120." />
        <TextField label="Changes per minute" inputMode="numeric" value={write} onChange={(e) => setWrite(e.target.value.trim())} error={writeError} helper="Adding, changing, approving or deleting. Usual setting: 30." />
      </div>
    </Dialog>
  );
}
