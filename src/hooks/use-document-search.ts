import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { api } from "@/services/api";
import { normaliseFilters, type SearchFilters } from "@/services/search-rules";

const key = (f: SearchFilters) => normaliseFilters(f);

export const searchPagesQuery = (filters: SearchFilters) =>
  infiniteQueryOptions({
    queryKey: ["documents", "search", key(filters)],
    queryFn: ({ pageParam }) => api.searchDocuments({ filters: key(filters), cursor: pageParam }),
    initialPageParam: null as { v: string; id: string } | null,
    getNextPageParam: (last) => last.next,
    staleTime: 30_000,
  });

export const previewQuery = (filters: SearchFilters, limit = 10) =>
  queryOptions({
    queryKey: ["documents", "preview", key(filters), limit],
    queryFn: () => api.searchDocuments({ filters: key(filters), cursor: null, limit }),
    staleTime: 30_000,
  });

export function useSearchPages(filters: SearchFilters) {
  return useInfiniteQuery(searchPagesQuery(filters));
}

export function useDocumentCount(filters: SearchFilters) {
  return useQuery({
    queryKey: ["documents", "count", key(filters)],
    queryFn: () => api.countDocuments(key(filters)),
    staleTime: 60_000,
  });
}

export function useFacets(filters: SearchFilters) {
  return useQuery({
    queryKey: ["documents", "facets", key(filters)],
    queryFn: () => api.facetDocuments(key(filters)),
    staleTime: 60_000,
  });
}

export function useRecordMatches(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["records", "match", q],
    queryFn: () => api.findRecord(q),
    enabled,
    staleTime: 60_000,
  });
}

/** The record a document belongs to, by its exact id; null when the caller can't see it. */
export function useRecordSummary(entityId: string | null) {
  return useQuery({
    queryKey: ["records", "summary", entityId],
    queryFn: async () => {
      const rows = await api.findRecord(entityId as string);
      return rows.find((r) => r.id.toLowerCase() === (entityId as string).toLowerCase()) ?? null;
    },
    enabled: Boolean(entityId && entityId.length >= 2),
    staleTime: 5 * 60_000,
  });
}

export function useSavedViews() {
  return useQuery({
    queryKey: ["savedViews"],
    queryFn: () => api.listSavedViews(),
    staleTime: 60_000,
  });
}

/**
 * One count per record kind under the other filters, so every facet shows a count. Seven small
 * cached count queries; the facet query has no record-kind count.
 */
export function useEntityKindCounts(
  filters: SearchFilters,
  kinds: readonly string[],
): Record<string, number | undefined> {
  const { entityTypes: _picked, ...rest } = filters;
  const results = useQueries({
    queries: kinds.map((t) => {
      const f = key({ ...rest, entityTypes: [t] } as SearchFilters);
      return {
        queryKey: ["documents", "count", f],
        queryFn: () => api.countDocuments(f),
        staleTime: 60_000,
      };
    }),
  });
  return Object.fromEntries(kinds.map((t, i) => [t, results[i]?.data]));
}
