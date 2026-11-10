import { queryOptions } from "@tanstack/react-query";
import { api, SeamFailure } from "@/services/api";
import { friendlyError } from "@/lib/document-labels";

export const configQuery = queryOptions({ queryKey: ["config"], queryFn: () => api.getConfig() });
export const childTenantsQuery = queryOptions({ queryKey: ["tenants", "children"], queryFn: () => api.listChildTenants() });
export const childViewQuery = (tenantId: string) =>
  queryOptions({ queryKey: ["tenant", tenantId], queryFn: () => api.getChildView(tenantId) });

/** The server's plain reason when it gives one (e.g. a hard floor), otherwise a friendly message. */
export function failureText(e: unknown): string {
  if (e instanceof SeamFailure) return e.detail && !/^\d{4}-/.test(e.detail) ? e.detail : friendlyError(e.code);
  return friendlyError(undefined);
}
