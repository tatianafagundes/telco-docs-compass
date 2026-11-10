import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
  return useQuery({ queryKey: ["documents", "count", key(filters)], queryFn: () => api.countDocuments(key(filters)), staleTime: 60_000 });
}

export function useFacets(filters: SearchFilters) {
  return useQuery({ queryKey: ["documents", "facets", key(filters)], queryFn: () => api.facetDocuments(key(filters)), staleTime: 60_000 });
}

export function useRecordMatches(q: string, enabled: boolean) {
  return useQuery({ queryKey: ["records", "match", q], queryFn: () => api.findRecord(q), enabled, staleTime: 60_000 });
}

export function useSavedViews() {
  return useQuery({ queryKey: ["savedViews"], queryFn: () => api.listSavedViews(), staleTime: 60_000 });
}
