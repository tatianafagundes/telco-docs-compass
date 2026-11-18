// "Choose a record": the first step of adding documents from the Documents page. Documents always
// belong to a record, so this finds one and opens its page ready to add files. Knows nothing about
// uploading itself; the record page does that.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/erad/button";
import { Dialog } from "@/components/erad/dialog";
import { TextField } from "@/components/erad/text-field";
import { previewQuery, useRecordMatches } from "@/hooks/use-document-search";
import { recordKindLabel } from "@/lib/document-labels";

type Rec = { id: string; name: string; type: string };
const MIN_CHARS = 2;
const SHOWN_MAX = 5;

export function ChooseRecordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    if (!open) {
      setText("");
      setQ("");
    }
  }, [open]);
  // Both: the typed text decides at once, the debounced query only adds the wait.
  const searching = text.trim().length >= MIN_CHARS && q.length >= MIN_CHARS;
  const matches = useRecordMatches(q, open && searching);
  // Recently changed records, from the documents the person can already see.
  const recent = useQuery({ ...previewQuery({}, 10), enabled: open && text === "" });
  const recents: Rec[] = [];
  for (const d of recent.data?.items ?? []) {
    if (!d.entity_id || !d.entity_name || recents.some((r) => r.id === d.entity_id)) continue;
    recents.push({ id: d.entity_id, name: d.entity_name, type: d.entity_type ?? "" });
    if (recents.length === SHOWN_MAX) break;
  }
  const shownQuery = q.length > 40 ? `${q.slice(0, 40)}…` : q;
  const status =
    text.trim().length > 0 && text.trim().length < MIN_CHARS
      ? "Keep typing. 2 characters are enough to search."
      : !searching
        ? ""
        : matches.isError
          ? "We couldn't search just now."
          : matches.isPending
            ? "Searching…"
            : matches.data.length === 0
              ? `No record starts with “${shownQuery}”. Check the number, or type the start of the name. Records you don't have access to aren't listed.`
              : matches.data.length >= SHOWN_MAX
                ? "Showing the first 5. Type more to narrow it down."
                : `${matches.data.length} ${matches.data.length === 1 ? "record" : "records"} found`;
  const items: Rec[] = searching ? (matches.data ?? []) : text === "" ? recents : [];
  const focusItem = (i: number) => list.current?.querySelectorAll<HTMLElement>("a")[i]?.focus();
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "ArrowDown" || e.key === "Enter") && items.length > 0) {
      e.preventDefault();
      focusItem(0);
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const links = [...(list.current?.querySelectorAll<HTMLElement>("a") ?? [])];
    const i = links.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" && i < links.length - 1) {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i <= 0) field.current?.focus();
      else focusItem(i - 1);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a record"
      description="Every document is kept with an order, quote or account. Choose the one these files belong to."
      initialFocusRef={field}
      backdrop
    >
      <TextField
        ref={field}
        label="Find an order, quote or account"
        helper="Type at least 2 characters of its number, or the start of its name."
        prefix={<Search className="size-4" aria-hidden="true" />}
        value={text}
        maxLength={64}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onFieldKey}
      />
      <p role="status" aria-live="polite" className="type-label-12 text-text-secondary">
        {status}
      </p>
      {searching && matches.isError ? (
        <Button className="self-start" onClick={() => void matches.refetch()}>
          Try again
        </Button>
      ) : null}
      {items.length > 0 ? (
        <div className="flex flex-col gap-1">
          {!searching ? (
            <h3 id="recent-records" className="type-label-12 text-text-secondary">
              Recently changed
            </h3>
          ) : null}
          <ul
            ref={list}
            aria-label={searching ? "Matching records" : undefined}
            aria-labelledby={searching ? undefined : "recent-records"}
            className="-mx-2 flex flex-col"
            onKeyDown={onListKey}
          >
            {items.map((r) => (
              <li key={r.id}>
                <Link
                  to="/records/$entityId"
                  params={{ entityId: r.id }}
                  search={{ add: 1 }}
                  className="focus-ring group type-label-14 flex min-h-10 items-center gap-2 rounded-control px-2 hover:bg-item-hover"
                >
                  <span className="type-label-12 shrink-0 text-text-secondary group-hover:text-text-main">
                    {recordKindLabel(r.type)}
                  </span>
                  <span className="truncate">{r.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}
