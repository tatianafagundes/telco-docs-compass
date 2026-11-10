import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/erad/button";
import type { ReviewField } from "@/services/review-rules";
import { cn } from "@/lib/utils";

export interface SamplePage {
  page: number;
  lines: { y: number; text: string }[];
}

export interface DocumentPageProps {
  pages: SamplePage[];
  fields: ReviewField[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The synthetic document page with numbered source boxes; clicking a box selects its field. */
export function DocumentPage({ pages, fields, selectedId, onSelect }: DocumentPageProps) {
  const [pageNo, setPageNo] = useState(pages[0]?.page ?? 1);
  const [zoom, setZoom] = useState(1);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const selected = fields.find((f) => f.id === selectedId);

  useEffect(() => {
    if (selected?.source?.page && selected.source.page !== pageNo) setPageNo(selected.source.page);
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, pageNo]);

  const page = pages.find((p) => p.page === pageNo);
  const onPage = fields.filter((f) => (f.source?.page ?? 1) === pageNo && f.source?.box);

  return (
    <section aria-label="Document page" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="icon" aria-label="Zoom out" unavailable={zoom <= 0.75} onClick={() => setZoom(Math.max(0.75, zoom - 0.25))}><Minus aria-hidden="true" /></Button>
        <span className="type-label-12 w-12 text-center">{Math.round(zoom * 100)} %</span>
        <Button size="icon" aria-label="Zoom in" unavailable={zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + 0.25))}><Plus aria-hidden="true" /></Button>
        {pages.length > 1 ? (
          <span className="type-label-12 ml-auto">
            Page {pageNo} of {pages.length}
          </span>
        ) : null}
      </div>
      <div className="overflow-auto border border-border-subtle bg-layer-application p-4">
        {page ? (
          <div className={cn("relative mx-auto aspect-[1/1.414] bg-item text-text-main shadow-elev-1", zoom === 0.75 ? "w-3/4" : zoom === 1 ? "w-full" : zoom === 1.25 ? "w-[125%]" : zoom === 1.5 ? "w-[150%]" : zoom === 1.75 ? "w-[175%]" : "w-[200%]")}>
            {page.lines.map((l, i) => (
              <p key={i} className={cn("absolute left-[10%] type-paragraph-14", i === 0 && "type-title-16-medium")} style={{ top: `${l.y * 100}%` }}>
                {l.text}
              </p>
            ))}
            {onPage.map((f) => {
              const n = fields.indexOf(f) + 1;
              const b = f.source?.box;
              if (!b) return null;
              const isSel = f.id === selectedId;
              return (
                <button
                  key={f.id}
                  ref={isSel ? selectedRef : undefined}
                  type="button"
                  aria-label={`Detail ${n}`}
                  aria-pressed={isSel}
                  onClick={() => onSelect(f.id)}
                  className={cn("focus-ring absolute border", isSel ? "border-2 border-focus" : "border-border-subtle")}
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100 - 1}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                >
                  <span className="type-label-12 absolute -top-5 -left-0.5 bg-item px-1">[{n}]</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="type-paragraph-14">This page can't be shown in the prototype. The details on the right can still be checked.</p>
        )}
      </div>
    </section>
  );
}
