// Says each document's processing change once, without moving focus (file-hooks spec R5.5): a polite
// status for a step done, an alert for a failure or a blocked file. Nothing on the first list.
import { useEffect, useRef, useState } from "react";
import { announcements } from "@/lib/pipeline-copy";
import type { PipelineState } from "@/schemas/document";

export function ProcessingAnnouncer({
  docs,
}: {
  docs: readonly { id: string; name: string; pipeline_state: PipelineState }[];
}) {
  const seen = useRef<Map<string, PipelineState> | null>(null);
  const [polite, setPolite] = useState("");
  const [urgent, setUrgent] = useState("");
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(docs.map((d) => [d.id, d.pipeline_state]));
    if (!before) return;
    const said = announcements(before, docs);
    if (!said.length) return;
    const join = (u: boolean) =>
      said
        .filter((a) => a.urgent === u)
        .map((a) => `${a.text}.`)
        .join(" ");
    const calm = join(false);
    const loud = join(true);
    if (calm) setPolite(calm);
    if (loud) setUrgent(loud);
  }, [docs]);
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {polite}
      </div>
      <div role="alert" className="sr-only">
        {urgent}
      </div>
    </>
  );
}
