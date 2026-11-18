// The record a document belongs to, as a link, in the document panel. Knows nothing about the
// document itself; never shows anything about a record the person can't open.
import { Link } from "@tanstack/react-router";
import { useRecordSummary } from "@/hooks/use-document-search";
import { recordLabel } from "@/lib/document-labels";

export const NO_RECORD_ACCESS = "Part of a record you don't have access to";

export function RecordLine({ entityId }: { entityId: string | null }) {
  const record = useRecordSummary(entityId);
  if (entityId === null) return <Muted>{NO_RECORD_ACCESS}</Muted>;
  // Keep the line's height while loading so the panel doesn't jump.
  if (record.isPending) return <div className="min-h-6" aria-hidden="true" />;
  if (record.isError)
    return (
      <p className="type-label-12 flex min-h-6 flex-wrap items-center gap-2 text-text-secondary">
        We couldn't load the record just now.
        <button
          type="button"
          className="focus-ring inline-flex min-h-6 items-center underline"
          onClick={() => void record.refetch()}
        >
          Try again
        </button>
      </p>
    );
  if (!record.data) return <Muted>{NO_RECORD_ACCESS}</Muted>;
  return (
    <Link
      to="/records/$entityId"
      params={{ entityId: record.data.id }}
      className="focus-ring type-label-12 line-clamp-2 min-h-6 self-start text-text-link underline underline-offset-2 [overflow-wrap:anywhere]"
    >
      {recordLabel(record.data.type, record.data.name)}
    </Link>
  );
}

function Muted({ children }: { children: string }) {
  return <p className="type-label-12 text-text-secondary">{children}</p>;
}
