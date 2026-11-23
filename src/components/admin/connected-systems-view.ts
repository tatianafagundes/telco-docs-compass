import type { ConnectedSystem } from "@/services/integration-clients.functions";
import type { Scope } from "@/services/tmf667-mapper";
/** Short words for the "Can:" line; the full sentences stay in the connect dialog. */
export const SCOPE_SHORT: Record<Scope, string> = {
  read: "Read",
  register: "Add and edit",
  transition: "Move status",
  approve: "Approve",
  hold: "Hold",
  delete: "Delete",
  subscribe: "Notifications",
};
export function canLine(scopes: readonly string[]): string {
  return scopes.map((x) => SCOPE_SHORT[x as Scope] ?? x).join(", ");
}
/** Show a filter once the list no longer fits on one screen. */
export const FILTER_FROM = 6;
/**
 * Connected systems first, in name order, filtered by name or kind label;
 * disconnected ones apart, newest first, so they can sit collapsed under their count.
 */
export function splitSystems(
  systems: readonly ConnectedSystem[],
  query: string,
  kindLabel: (kind: string) => string,
): { connected: ConnectedSystem[]; disconnected: ConnectedSystem[] } {
  const q = query.trim().toLowerCase();
  const hit = (s: ConnectedSystem) =>
    q === "" ||
    s.name.toLowerCase().includes(q) ||
    kindLabel(s.systemKind).toLowerCase().includes(q);
  const connected = systems
    .filter((s) => !s.revokedAt && hit(s))
    .sort((a, b) => a.name.localeCompare(b.name));
  const disconnected = systems
    .filter((s) => !!s.revokedAt && hit(s))
    .sort((a, b) => (b.revokedAt ?? "").localeCompare(a.revokedAt ?? ""));
  return { connected, disconnected };
}
