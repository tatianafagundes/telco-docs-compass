// Says each document's processing change once, without moving focus (file-hooks spec R5.5): a polite
// status for a step done, an alert for a failure or a blocked file. Nothing on the first list. Each
// announcement is its own new element, so the same words said again (a file that fails again after
// Try again) are still announced (design review B1); they are removed after a few seconds.
import { useEffect, useRef, useState } from "react";
import { announcements, type Announcement } from "@/lib/pipeline-copy";
import type { PipelineState } from "@/schemas/document";

/** How long an announcement stays in the page after it was said. */
export const ANNOUNCEMENT_MS = 5_000;
interface Said extends Announcement {
  key: number;
}

export function ProcessingAnnouncer({
  docs,
}: {
  docs: readonly {
    id: string;
    name: string;
    pipeline_state: PipelineState;
    pipeline_detail?: unknown;
  }[];
}) {
  const seen = useRef<Map<string, PipelineState> | null>(null);
  const next = useRef(0);
  const [said, setSaid] = useState<Said[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(docs.map((d) => [d.id, d.pipeline_state]));
    if (!before) return;
    const fresh = announcements(before, docs).map((a) => ({ ...a, key: next.current++ }));
    if (!fresh.length) return;
    setSaid((s) => [...s, ...fresh]);
    const keys = new Set(fresh.map((f) => f.key));
    // Not cleared when the list changes again: only when the page goes away.
    timers.current.add(
      setTimeout(() => setSaid((s) => s.filter((x) => !keys.has(x.key))), ANNOUNCEMENT_MS),
    );
  }, [docs]);
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {said
          .filter((a) => !a.urgent)
          .map((a) => (
            <p key={a.key}>{a.text}</p>
          ))}
      </div>
      <div role="alert" className="sr-only">
        {said
          .filter((a) => a.urgent)
          .map((a) => (
            <p key={a.key}>{a.text}</p>
          ))}
      </div>
    </>
  );
}
