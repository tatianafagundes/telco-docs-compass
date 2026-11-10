import { PIPELINE_LABEL, STATUS_LABEL } from "@/lib/document-labels";
import type { DocStatus, PipelineState } from "@/schemas/document";
import type { StatRow } from "@/services/tenant-config.functions";

function group(rows: StatRow[], key: (r: StatRow) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.n);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Counts only – never names or content. */
export function StatCounts({ rows }: { rows: StatRow[] }) {
  if (rows.length === 0) return <p className="type-paragraph-14 text-text-secondary">No documents yet.</p>;
  const blocks: [string, [string, number][]][] = [
    ["By type", group(rows, (r) => r.documentType)],
    ["By status", group(rows, (r) => STATUS_LABEL[r.status as DocStatus] ?? r.status)],
    ["By processing", group(rows, (r) => PIPELINE_LABEL[r.pipelineState as PipelineState] ?? r.pipelineState)],
  ];
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {blocks.map(([title, items]) => (
        <section key={title} className="flex flex-col gap-1">
          <h4 className="type-label-14-medium">{title}</h4>
          <dl className="type-label-14 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {items.map(([k, n]) => (
              <div key={k} className="contents">
                <dt className="text-text-secondary">{k}</dt>
                <dd className="text-right tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
