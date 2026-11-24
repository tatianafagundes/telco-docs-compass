// Admin > Connected systems: whether files wait for the organisation's own antivirus and reader, or
// use the built-in check (file-hooks spec D1, R5.6). Turning a step on needs a confirmation; turning
// it off warns that protection is weaker. The database records each change in the activity.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { Card } from "@/components/erad/card";
import { Checkbox } from "@/components/erad/checkbox";
import { Dialog } from "@/components/erad/dialog";
import { Banner } from "@/components/erad/banner";
import { Tag } from "@/components/erad/tag";
import { failureText } from "@/hooks/use-config";
import {
  STEP_COPY,
  switchKey,
  systemFor,
  type Step,
} from "@/components/admin/processing-switch-view";
import { api } from "@/services/api";
import { EXTERNAL_RESULT_TIMEOUT_MINUTES } from "@/services/file-hook-timeouts";
import type { ConnectedSystem } from "@/services/integration-clients.functions";
import { middleTruncate } from "@/services/upload-rules";
const N = EXTERNAL_RESULT_TIMEOUT_MINUTES;

/** The confirm button names the result, never "on" or "off" (design review B3). */
const confirmLabel = (c: { step: Step; on: boolean }) => {
  const t = c.on ? STEP_COPY[c.step].own : STEP_COPY[c.step].builtIn;
  return `Use ${t}`;
};
export function ProcessingSwitch({ systems }: { systems: readonly ConnectedSystem[] }) {
  const qc = useQueryClient();
  const sw = useQuery({ queryKey: switchKey, queryFn: () => api.getProcessingSwitch() });
  const [changing, setChanging] = useState<{ step: Step; on: boolean } | null>(null);
  const [understood, setUnderstood] = useState(false);
  const save = useMutation({
    mutationFn: (c: { step: Step; on: boolean }) => api.setProcessingSwitch({ [c.step]: c.on }),
    onSuccess: (_r, c) => {
      setChanging(null);
      toast.success(
        c.on
          ? `Files now wait for ${STEP_COPY[c.step].own}.`
          : `Files now use ${STEP_COPY[c.step].builtIn}.`,
      );
      void qc.invalidateQueries({ queryKey: switchKey });
    },
    onError: (e) => toast.error(failureText(e)),
  });
  const open = (step: Step, on: boolean) => {
    setUnderstood(false);
    setChanging({ step, on });
  };
  return (
    <Card title="Your own antivirus and reader">
      {sw.isPending ? (
        <p className="type-paragraph-14 text-text-secondary" role="status">
          Loading…
        </p>
      ) : sw.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="type-paragraph-14">We couldn't load this setting just now.</p>
          <Button onClick={() => void sw.refetch()}>Try again</Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Processing steps">
          {(["scan", "read"] as const).map((step) => {
            const on = sw.data[step];
            const system = systemFor(systems, step);
            const c = STEP_COPY[step];
            return (
              <li key={step} className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="type-label-14 flex flex-wrap items-center gap-2">
                    {c.title}
                    {/* Neutral either way: the choice is not good versus bad (design review N7). */}
                    <Tag small>{on ? "Own system" : "Built-in"}</Tag>
                  </span>
                  <p className="type-paragraph-14 text-text-secondary">
                    {on
                      ? system
                        ? `Files wait for ${middleTruncate(system.name, 48)}.`
                        : `Files wait for ${c.own}, but none is connected: they fail after ${N} minutes.`
                      : step === "scan"
                        ? "The built-in check is simulated in this prototype."
                        : "The built-in reader is simulated in this prototype."}
                  </p>
                </div>
                <Button onClick={() => open(step, !on)}>
                  {on ? `Use ${c.builtIn}` : `Use ${c.own}`}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={changing !== null}
        onOpenChange={(o) => !o && setChanging(null)}
        title={
          changing
            ? changing.on
              ? `Use ${STEP_COPY[changing.step].own}?`
              : `Use ${STEP_COPY[changing.step].builtIn} again?`
            : ""
        }
        description={
          changing ? (changing.on ? STEP_COPY[changing.step].on : STEP_COPY[changing.step].off) : ""
        }
        actions={
          <>
            <Button onClick={() => setChanging(null)}>Cancel</Button>
            <Button
              // Lowering protection is styled as the risk it is (design review B3).
              variant={
                changing && !changing.on && changing.step === "scan" ? "destructive" : "primary"
              }
              unavailable={save.isPending || (changing?.on === true && !understood)}
              onClick={() => changing && save.mutate(changing)}
            >
              {changing ? confirmLabel(changing) : ""}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {changing?.on && !systemFor(systems, changing.step) ? (
            <Banner tone="warning" status="No system connected">
              No system with this permission is connected yet. Until one is, every new file fails
              after {N} minutes.
            </Banner>
          ) : null}
          {changing?.on ? (
            <Checkbox
              label={
                systemFor(systems, changing.step)
                  ? "I understand files will wait for this system"
                  : `I understand files will fail after ${N} minutes until a system is connected`
              }
              checked={understood}
              onCheckedChange={(v) => setUnderstood(v === true)}
            />
          ) : null}
          <p className="type-label-12 text-text-secondary">
            The change is recorded in the organisation's activity.
          </p>
        </div>
      </Dialog>
    </Card>
  );
}
