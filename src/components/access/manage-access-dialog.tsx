import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Dialog } from "@/components/erad/dialog";
import { Button } from "@/components/erad/button";
import { Select } from "@/components/erad/select";
import { TextField } from "@/components/erad/text-field";
import { Spinner } from "@/components/erad/misc";
import { accessQuery, entitiesQuery, useAccessChanges, usePeopleSearch } from "@/hooks/use-access";
import { isExpired, pageOf, PAGE_SIZE, type AccessItem } from "@/services/review-rules";
import { cn } from "@/lib/utils";

const LEVEL = { view: "Can view", edit: "Can edit" } as const;
const LEVEL_OPTIONS = [{ options: [{ value: "view", label: "Can view" }, { value: "edit", label: "Can edit" }] }];

export interface ManageAccessDialogProps {
  docId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Add people, see who has access through the record, and manage one-off exceptions. */
export function ManageAccessDialog({ docId, open, onOpenChange }: ManageAccessDialogProps) {
  const access = useQuery({ ...accessQuery(docId), enabled: open });
  const entities = useQuery({ ...entitiesQuery, enabled: open });
  const { grant, revoke } = useAccessChanges(docId);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [level, setLevel] = useState<"view" | "edit">("view");
  const [until, setUntil] = useState("");
  const [page, setPage] = useState(0);
  const people = usePeopleSearch(picked ? "" : query);
  const now = new Date();
  const entityName = (id: string) => entities.data?.find((e) => e.id === id)?.display_name ?? id;

  const items = access.data ?? [];
  const inherited = items.filter((i) => i.source === "inheritedFromEntity");
  const byEntity = new Map<string, AccessItem[]>();
  inherited.forEach((i) => { const k = i.viaEntity?.id ?? "-"; byEntity.set(k, [...(byEntity.get(k) ?? []), i]); });
  const exceptions = items.filter((i) => i.source === "explicit");

  const add = () => {
    if (!picked) return;
    grant.mutate(
      { userId: picked.id, level, ...(until ? { expiresAt: new Date(`${until}T23:59:59Z`).toISOString() } : {}) },
      { onSuccess: () => { setPicked(null); setQuery(""); setUntil(""); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Manage access" description="Restricted – only people with access can open this document. This prototype has no public links.">
      <section aria-labelledby="add-people" className="flex flex-col gap-2">
        <h4 id="add-people" className="type-label-14">Add people</h4>
        {picked ? (
          <p className="type-label-14 flex items-center gap-2">
            {picked.name}
            <button type="button" className="focus-ring type-label-12 underline" onClick={() => setPicked(null)}>Change</button>
          </p>
        ) : (
          <>
            <TextField label="Add people or teams" helper="Only people in your organisation appear here." value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            {query.trim() ? (
              people.isPending ? <Spinner label="Looking for people" /> :
              people.isError ? <p className="type-label-12">We couldn't search just now. <button type="button" className="focus-ring underline" onClick={() => void people.refetch()}>Try again</button></p> :
              (people.data ?? []).length === 0 ? <p className="type-label-12 text-text-secondary">No one in your organisation matches “{query}”.</p> : (
                <ul aria-label="Matching people" className="flex flex-col border border-border-subtle">
                  {(people.data ?? []).map((p) => (
                    <li key={p.id}>
                      <button type="button" className="focus-ring type-label-14 min-h-8 w-full px-3 py-1 text-left hover:bg-item-hover" onClick={() => setPicked(p)}>{p.name}</button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Role" groups={LEVEL_OPTIONS} value={level} onValueChange={(v) => setLevel(v === "edit" ? "edit" : "view")} />
          <TextField label="Until (optional)" type="date" value={until} min={format(now, "yyyy-MM-dd")} onChange={(e) => setUntil(e.target.value)} />
          <Button variant="primary" unavailable={!picked || grant.isPending} aria-describedby={!picked ? "add-reason" : undefined} onClick={add}>Add</Button>
        </div>
        {!picked ? <p id="add-reason" className="type-label-12 text-text-secondary">Choose a person first.</p> : null}
      </section>

      {access.isPending ? <Spinner label="Loading access" /> : access.isError ? (
        <p className="type-paragraph-14">We couldn't load who has access. <button type="button" className="focus-ring underline" onClick={() => void access.refetch()}>Try again</button></p>
      ) : (
        <div className="flex max-h-[40vh] flex-col gap-4 overflow-y-auto">
          {[...byEntity.entries()].map(([eid, list]) => (
            <details key={eid} className="flex flex-col gap-1">
              <summary className="focus-ring type-label-14 cursor-pointer">Inherited from {entityName(eid)} · {list.length} {list.length === 1 ? "person" : "people"} can view</summary>
              <ul className="flex flex-col">
                {pageOf(list, page).map((i) => (
                  <li key={i.subject.id} className="flex min-h-8 items-center justify-between gap-2 border-b border-border-subtle">
                    <span className="type-label-14">{i.subject.displayName ?? "Someone in your organisation"}</span>
                    <span className="type-label-12 text-text-secondary">{LEVEL[i.level as "view" | "edit"] ?? i.level} · via {entityName(eid)}</span>
                  </li>
                ))}
              </ul>
              {list.length > PAGE_SIZE ? (
                <div className="flex gap-2">
                  <Button unavailable={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                  <Button unavailable={(page + 1) * PAGE_SIZE >= list.length} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              ) : null}
              {eid !== "-" ? (
                <Link to="/records/$entityId" params={{ entityId: eid }} search={{}} className="focus-ring type-label-12 underline">Open {entityName(eid)} to change this</Link>
              ) : null}
            </details>
          ))}
          <section aria-labelledby="exceptions" className="flex flex-col gap-1">
            <h4 id="exceptions" className="type-label-14">Exceptions</h4>
            {exceptions.length === 0 ? (
              <p className="type-paragraph-14 text-text-secondary">No exceptions. Access follows the order.</p>
            ) : (
              <ul className="flex flex-col">
                {exceptions.map((i) => {
                  const expired = isExpired(i.expiresAt, now);
                  return (
                    <li key={i.subject.id} className="flex min-h-12 items-center justify-between gap-2 border-b border-border-subtle">
                      <span className="flex flex-col">
                        <span className={cn("type-label-14", expired && "line-through")}>{i.subject.displayName ?? "Someone in your organisation"}</span>
                        <span className="type-label-12 text-text-secondary">
                          {LEVEL[i.level as "view" | "edit"] ?? i.level}
                          {i.grantedBy ? ` · added by ${i.grantedBy}` : ""}
                          {i.expiresAt ? (expired ? ` · Expired ${format(new Date(i.expiresAt), "d MMM")}` : ` · until ${format(new Date(i.expiresAt), "d MMM")}`) : ""}
                        </span>
                      </span>
                      <Button unavailable={revoke.isPending} onClick={() => revoke.mutate(i.subject.id)}>Remove access</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
