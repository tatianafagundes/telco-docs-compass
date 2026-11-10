import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, FileSearch, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/erad/button";
import { EmptyState } from "@/components/erad/empty-state";
import { SkeletonRow } from "@/components/erad/misc";
import { PageHeader } from "@/components/erad/page-header";
import { Select } from "@/components/erad/select";
import { SidePanel } from "@/components/erad/side-panel";
import { TextField } from "@/components/erad/text-field";
import { DocumentPanel } from "@/components/documents/document-panel";
import { BulkBar } from "@/components/search/bulk-bar";
import { FacetPanel } from "@/components/search/facet-panel";
import { ResultsTable } from "@/components/search/results-table";
import { SavedViews } from "@/components/search/saved-views";
import { filtersOf, parseDocumentsSearch, type DocumentsSearch } from "@/components/search/search-url";
import { StartLists } from "@/components/search/start-lists";
import { useDocumentCount, useRecordMatches, useSearchPages } from "@/hooks/use-document-search";
import { meQuery, useMe } from "@/hooks/use-me";
import type { AppRole } from "@/services/document-rules";
import { countLabel, hasAnyFilter, looksLikeIdentifier, type SearchFilters, type SortKey } from "@/services/search-rules";

export const Route = createFileRoute("/_authenticated/documents")({
  validateSearch: (raw: Record<string, unknown>): DocumentsSearch => parseDocumentsSearch(raw),
  head: () => ({
    meta: [
      { title: "Documents" },
      { name: "description", content: "Search, filter and change documents across orders, quotes, accounts and customers." },
      { property: "og:title", content: "Documents" },
      { property: "og:description", content: "Search, filter and change documents across orders, quotes, accounts and customers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(meQuery),
  pendingComponent: () => <div>{Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} columns={2} />)}</div>,
  errorComponent: () => <EmptyState icon={FileSearch} title="Documents couldn't load" cause="Something interrupted the connection. Reloading the page usually helps." />,
  component: DocumentsPage,
});

const SORT_LABEL: Record<SortKey, string> = { updated: "Recently changed", name: "Name A–Z", expiry: "Expiring soonest" };

function DocumentsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/documents" });
  const me = useMe();
  const role = (me.access?.role ?? "viewer") as AppRole;
  const isAdmin = role === "tenant_admin";
  const filters = useMemo(() => filtersOf(search), [search]);
  const showResults = hasAnyFilter(filters) || Boolean(search.all);

  const setFilters = (f: SearchFilters, all = search.all) =>
    void navigate({ search: { ...filtersOf(f), ...(all ? { all: true } : {}), ...(search.doc ? { doc: search.doc } : {}) } });
  const open = (id: string) => void navigate({ search: (prev) => ({ ...prev, doc: id }) });
  const close = () => void navigate({ search: (prev) => { const { doc: _d, ...rest } = prev; return rest; } });

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <PageHeader title="Documents" />
        <SearchBox value={search.q ?? ""} onSearch={(q) => setFilters({ ...filters, q })} />
        <SavedViews filters={filters} isAdmin={isAdmin} onApply={(f) => setFilters(f, true)} />
        {search.q && looksLikeIdentifier(search.q) ? <RecordMatches q={search.q} /> : null}
        {showResults ? (
          <Results filters={filters} role={role} activeId={search.doc} onOpen={open} onChange={(f) => setFilters(f)} onClearAll={() => void navigate({ search: {} })} />
        ) : (
          <StartLists isAdmin={isAdmin} onOpen={open} onSeeAll={(f) => setFilters(f, true)} />
        )}
      </div>
      {search.doc ? (
        <SidePanel title="Document" collapsed={false} onCollapsedChange={close}>
          <DocumentPanel id={search.doc} entityId={null} role={role} />
        </SidePanel>
      ) : null}
    </div>
  );
}

function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim() === value.trim()) return;
    const t = setTimeout(() => onSearch(text), 300);
    return () => clearTimeout(t);
  }, [text, value, onSearch]);
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); onSearch(text); }} className="max-w-[720px]">
      <TextField
        label="Search documents"
        helper="Names, descriptions, confirmed details, or an order, quote or contract number."
        prefix={<Search className="size-4" aria-hidden="true" />}
        suffix={
          text ? (
            <button type="button" aria-label="Clear search" className="focus-ring flex size-6 items-center justify-center" onClick={() => { setText(""); onSearch(""); }}>
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : undefined
        }
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}

function RecordMatches({ q }: { q: string }) {
  const m = useRecordMatches(q, true);
  if (!m.data || m.data.length === 0) return null;
  return (
    <ul aria-label="Matching records" className="flex flex-wrap gap-2">
      {m.data.map((r) => (
        <li key={r.id}>
          <Link to="/records/$entityId" params={{ entityId: r.id }} className="focus-ring type-label-14 inline-flex min-h-8 items-center gap-1 rounded-control border border-border-btn px-3 hover:bg-item-hover">
            Go to {r.name}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Results(p: { filters: SearchFilters; role: AppRole; activeId: string | undefined; onOpen: (id: string) => void; onChange: (f: SearchFilters) => void; onClearAll: () => void }) {
  const pages = useSearchPages(p.filters);
  const count = useDocumentCount(p.filters);
  const rows = useMemo(() => pages.data?.pages.flatMap((pg) => pg.items) ?? [], [pages.data]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [matchAll, setMatchAll] = useState(false);
  useEffect(() => { setSelected(new Set()); setMatchAll(false); }, [p.filters]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allLoaded = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const sort = p.filters.sort ?? "updated";

  return (
    <div className="flex min-h-[560px] flex-1 gap-6">
      <aside className="hidden w-56 shrink-0 md:block">
        <FacetPanel filters={p.filters} onChange={p.onChange} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="type-label-14" role="status" aria-live="polite">
            {count.isPending ? "Counting…" : count.isError ? "Results" : countLabel(count.data)}
          </p>
          <div className="flex items-end gap-2">
            {hasAnyFilter(p.filters) ? <Button variant="ghost" onClick={p.onClearAll}>Clear all</Button> : null}
            <Select label="Sort" value={sort} onValueChange={(v) => p.onChange({ ...p.filters, sort: v as SortKey })} groups={[{ options: (Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ value: k, label: SORT_LABEL[k] })) }]} />
          </div>
        </div>

        {selected.size > 0 || matchAll ? (
          <div className="flex flex-col gap-2">
            {allLoaded && !matchAll && count.data !== undefined && count.data > rows.length ? (
              <Button variant="ghost" onClick={() => { setMatchAll(true); setSelected(new Set()); }}>
                Select all {countLabel(count.data).replace(" documents", "")} matching instead
              </Button>
            ) : null}
            <BulkBar
              role={p.role}
              selectedIds={matchAll ? [] : [...selected]}
              matching={matchAll ? { filters: p.filters, count: count.data ?? 0 } : null}
              onClear={() => { setSelected(new Set()); setMatchAll(false); }}
            />
          </div>
        ) : null}

        {pages.isPending ? (
          <div>{Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} columns={4} />)}</div>
        ) : pages.isError ? (
          <div className="flex flex-col items-start gap-2 py-6">
            <p className="type-paragraph-14">The results couldn't load just now.</p>
            <Button onClick={() => void pages.refetch()}>Try again</Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="No documents match"
            cause="You can try fewer filters or a shorter word. Numbers like O-7731 also find the record itself."
            action={<Button onClick={p.onClearAll}>Clear all filters</Button>}
          />
        ) : (
          <ResultsTable
            rows={rows}
            activeId={p.activeId}
            onOpen={p.onOpen}
            selected={selected}
            onToggle={toggle}
            allSelected={allLoaded}
            onToggleAll={() => setSelected(allLoaded ? new Set() : new Set(rows.map((r) => r.id)))}
            hasMore={Boolean(pages.hasNextPage)}
            loadingMore={pages.isFetchingNextPage}
            onLoadMore={() => void pages.fetchNextPage()}
          />
        )}
      </div>
    </div>
  );
}
