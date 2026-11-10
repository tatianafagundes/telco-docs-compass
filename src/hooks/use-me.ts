import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getMe } from "@/services/document.functions";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => getMe(),
  staleTime: 60_000,
});

export function useMe() {
  return useSuspenseQuery(meQuery).data;
}
