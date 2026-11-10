import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, SeamFailure } from "@/services/api";
import { friendlyError } from "@/lib/document-labels";
import type { AccessItem } from "@/services/review-rules";

export const accessQuery = (docId: string) =>
  queryOptions({
    queryKey: ["access", docId],
    queryFn: async () => (await api.listAccess(docId)) as AccessItem[],
  });

export const entitiesQuery = queryOptions({ queryKey: ["entities"], queryFn: () => api.listEntities() });

export function usePeopleSearch(query: string) {
  return useQuery({
    queryKey: ["people", { query }],
    queryFn: () => api.searchPeople(query),
    enabled: query.trim().length >= 1,
  });
}

export function useAccessChanges(docId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["access", docId] });
    void qc.invalidateQueries({ queryKey: ["document", docId] });
  };
  const onError = (e: unknown) => toast.error(friendlyError(e instanceof SeamFailure ? e.code : undefined));
  const grant = useMutation({
    mutationFn: (v: { userId: string; level: "view" | "edit"; expiresAt?: string }) =>
      api.grantAccess({ id: docId, subject: { type: "user", id: v.userId }, level: v.level, ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}) }),
    onSuccess: () => { toast.success("Access added"); refresh(); },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (userId: string) => api.revokeAccess({ id: docId, subject: { type: "user", id: userId } }),
    onSuccess: () => { toast.success("Access removed"); refresh(); },
    onError,
  });
  return { grant, revoke };
}
