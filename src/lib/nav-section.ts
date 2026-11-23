// Which main navigation item a page belongs to, so a page deeper in a section (a record, the check
// details page, one shared document) still shows where the person is. Pure, no React.

/** Path prefixes of each section. Records are reached from Documents, so they belong to it. */
const SECTIONS: Record<string, string[]> = {
  "/documents": ["/documents", "/records"],
  "/shared": ["/shared"],
  "/holds": ["/holds"],
  "/admin": ["/admin"],
};

const within = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** How a navigation item relates to the current page: the page itself, a page inside it, or neither. */
export function navCurrent(item: string, pathname: string): "page" | "section" | null {
  if (pathname === item) return "page";
  return (SECTIONS[item] ?? [item]).some((p) => within(pathname, p)) ? "section" : null;
}

/** Where a person starts. The group administrator never works with documents, so starts in Admin. */
export function homeFor(role: string | undefined): "/documents" | "/admin" {
  return role === "master_admin" ? "/admin" : "/documents";
}

export type AdminArea =
  "/admin/types" | "/admin/policies" | "/admin/holds" | "/admin/systems" | "/admin/tenants";
/**
 * The areas inside Admin for a role, in order. They are children of Admin in the main
 * navigation (EDS local navigation is a tree), not a row of tabs on the page.
 */
export function adminAreas(role: string | undefined): { to: AdminArea; label: string }[] {
  if (role !== "tenant_admin" && role !== "master_admin") return [];
  return [
    { to: "/admin/types", label: "Document types" },
    { to: "/admin/policies", label: "Policies" },
    { to: "/admin/holds", label: "Holds and retention" },
    ...(role === "tenant_admin"
      ? [{ to: "/admin/systems" as const, label: "Connected systems" }]
      : []),
    ...(role === "master_admin" ? [{ to: "/admin/tenants" as const, label: "Tenants" }] : []),
  ];
}
/** The admin area a page is in, for its title; null outside Admin. */
export function adminAreaOf(
  role: string | undefined,
  pathname: string,
): { to: AdminArea; label: string } | null {
  return adminAreas(role).find((a) => within(pathname, a.to)) ?? null;
}
