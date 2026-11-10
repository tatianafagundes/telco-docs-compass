import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ShieldOff } from "lucide-react";
import { PageHeader } from "@/components/erad/page-header";
import { EmptyState } from "@/components/erad/empty-state";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin · Documents" },
      { name: "description", content: "Document types, policies and organisations shared across the group." },
      { property: "og:title", content: "Admin · Documents" },
      { property: "og:description", content: "Document types, policies and organisations shared across the group." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const me = useMe();
  const role = me.access?.role;
  if (role !== "tenant_admin" && role !== "master_admin") {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Admin is for administrators"
        cause="Your role lets you work with documents. An administrator can change settings for you."
      />
    );
  }
  const tabs = [
    { to: "/admin/types", label: "Document types" },
    { to: "/admin/policies", label: "Policies" },
    { to: "/admin/holds", label: "Holds and retention" },
    ...(role === "master_admin" ? [{ to: "/admin/tenants", label: "Tenants" } as const] : []),
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Admin" />
      <nav aria-label="Admin sections" className="flex gap-4 border-b border-border-subtle">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="focus-ring type-label-14 flex h-8 items-center border-b-2 px-1 hover:text-text-main"
            activeProps={{ className: "border-border-selected text-text-main", "aria-current": "page" }}
            inactiveProps={{ className: "border-transparent text-text-secondary" }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
