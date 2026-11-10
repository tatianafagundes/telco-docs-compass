import { queryOptions } from "@tanstack/react-query";
import { api } from "@/services/api";

export const sharedQuery = (page: number) =>
  queryOptions({
    queryKey: ["shared-documents", page],
    queryFn: () => api.listSharedWithMe(page),
  });
