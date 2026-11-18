// "Add documents" from the Documents page, in two steps: choose the order, quote or account, then
// choose the files. The files are handed to that record's page, which asks for their types and
// adds them. Knows nothing about uploading itself.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Upload } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/erad/button";
import { Dialog } from "@/components/erad/dialog";
import { TextField } from "@/components/erad/text-field";
import { handOverFiles } from "@/components/upload/upload-handoff";
import { previewQuery, useRecordMatches } from "@/hooks/use-document-search";
import { recordKindLabel, recordLabel } from "@/lib/document-labels";

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
  const [chosen, setChosen] = useState<Rec | null>(null);
  useEffect(() => {
    if (!open) setChosen(null);
  }, [open]);
  return chosen ? (
    <ChooseFiles
      record={chosen}
      open={open}
      onOpenChange={onOpenChange}
      onBack={() => setChosen(null)}
    />
  ) : (
    <FindRecord open={open} onOpenChange={onOpenChange} onChoose={setChosen} />
  );
}

function FindRecord({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (r: Rec) => void;
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
  const focusItem = (i: number) =>
    list.current?.querySelectorAll<HTMLElement>("button")[i]?.focus();
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "ArrowDown" || e.key === "Enter") && items.length > 0) {
      e.preventDefault();
      focusItem(0);
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" && i < buttons.length - 1) {
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
                <button
                  type="button"
                  onClick={() => onChoose(r)}
                  className="focus-ring group type-label-14 flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left hover:bg-item-hover"
                >
                  <span className="type-label-12 shrink-0 text-text-secondary group-hover:text-text-main">
                    {recordKindLabel(r.type)}
                  </span>
                  <span className="truncate">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

/** Step 2. The file picker opens from this click, so the browser allows it. */
function ChooseFiles({
  record,
  open,
  onOpenChange,
  onBack,
}: {
  record: Rec;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const choose = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const label = recordLabel(record.type, record.name);
  const go = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    handOverFiles(record.id, files);
    onOpenChange(false);
    void navigate({
      to: "/records/$entityId",
      params: { entityId: record.id },
      search: { add: 1 },
    });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Choose the files"
      description={`They will be added to ${label}. Next you choose what kind of document each one is.`}
      initialFocusRef={choose}
      backdrop
      actions={<Button onClick={onBack}>Choose a different record</Button>}
    >
      <div
        className={`flex flex-col items-start gap-2 border border-dashed p-4 ${dragging ? "border-focus" : "border-border-item"}`}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          (e.nativeEvent as DragEvent & { eradHandled?: boolean }).eradHandled = true;
          setDragging(false);
          go(e.dataTransfer.files);
        }}
      >
        <Button ref={choose} variant="primary" onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" />
          Choose files
        </Button>
        <p className="type-label-12 text-text-secondary">Or drop them here.</p>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="choose-files-input"
          onChange={(e) => go(e.target.files)}
        />
      </div>
      <Link
        to="/records/$entityId"
        params={{ entityId: record.id }}
        className="focus-ring type-label-12 inline-flex min-h-6 items-center self-start underline"
      >
        Open {label} instead
      </Link>
    </Dialog>
  );
}
