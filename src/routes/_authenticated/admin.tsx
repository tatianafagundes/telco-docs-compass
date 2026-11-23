import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ShieldOff } from "lucide-react";
import { PageHeader } from "@/components/erad/page-header";
import { EmptyState } from "@/components/erad/empty-state";
import { useMe } from "@/hooks/use-me";
import { adminAreaOf, adminParent } from "@/lib/nav-section";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin · Documents" },
      {
        name: "description",
        content: "Document types, policies and organisations shared across the group.",
      },
      { property: "og:title", content: "Admin · Documents" },
      {
        property: "og:description",
        content: "Document types, policies and organisations shared across the group.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const me = useMe();
  const role = me.access?.role;
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const area = adminAreaOf(role, pathname);
  const parent = adminParent(role, pathname);
  if (role !== "tenant_admin" && role !== "master_admin") {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Admin is for administrators"
        cause="Your role lets you work with documents. An administrator can change settings for you."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {/* The areas are children of Admin in the main navigation; the page is titled by its area. */}
      {parent ? (
        <Link
          to={parent.to}
          className="focus-ring type-label-12 inline-flex min-h-6 items-center self-start text-text-secondary hover:underline"
        >
          {parent.label}
        </Link>
      ) : (
        <PageHeader title={area?.label ?? "Admin"} />
      )}
      <Outlet />
    </div>
  );
}
