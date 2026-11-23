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
