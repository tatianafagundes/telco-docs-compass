import { createFileRoute, Link, Outlet, useMatch } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Building2, ShieldOff } from "lucide-react";
import { Card } from "@/components/erad/card";
import { EmptyState } from "@/components/erad/empty-state";
import { StatCounts } from "@/components/admin/stat-counts";
import { ResetTestData } from "@/components/admin/reset-test-data";
import { childTenantsQuery } from "@/hooks/use-config";
import { useMe } from "@/hooks/use-me";
import { canSeeTenants } from "@/services/tenant-rules";

export const Route = createFileRoute("/_authenticated/admin/tenants")({
  head: () => ({
    meta: [
      { title: "Tenants · Admin" },
      {
        name: "description",
        content: "Document counts and settings for each organisation in the group.",
      },
      { property: "og:title", content: "Tenants · Admin" },
      {
        property: "og:description",
        content: "Document counts and settings for each organisation in the group.",
      },
    ],
  }),
  component: TenantsLayout,
});

function TenantsLayout() {
  const me = useMe();
  const child = useMatch({ from: "/_authenticated/admin/tenants/$tenantId", shouldThrow: false });
  // Say so at once; asking the server for another country's list only ends in a long wait and an error.
  if (!canSeeTenants(me.access?.role))
    return (
      <EmptyState
        icon={ShieldOff}
        title="Tenants are for the group administrator"
        cause="Your role works with this organisation. The group administrator sees the counts and settings of every country."
      />
    );
  return child ? <Outlet /> : <TenantsPage />;
}

function TenantsPage() {
  const { data: kids } = useSuspenseQuery(childTenantsQuery);
  return (
    <div className="flex flex-col gap-4">
      <p className="type-paragraph-14">
        You see counts and settings. Document names and content stay inside each tenant.
      </p>
      <ResetTestData />
      {kids.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No organisations yet"
          cause="When a country joins the group, its counts and settings appear here."
        />
      ) : (
        kids.map((k) => (
          <Card
            key={k.id}
            title={k.displayName}
            actions={
              <Link
                to="/admin/tenants/$tenantId"
                params={{ tenantId: k.id }}
                className="focus-ring type-label-14 inline-flex h-8 items-center rounded-control border border-border-btn px-3 hover:bg-btn-default-hover"
              >
                View settings and counts
              </Link>
            }
          >
            <div className="flex flex-col gap-4">
              <p>
                {`${k.displayName} overrides ${k.overrides} ${k.overrides === 1 ? "type" : "types"}, adds ${k.adds}. ${k.total} documents.`}
              </p>
              <p className="text-text-secondary">
                {`Sharing with other organisations: ${k.crossTenantShare === "off" ? "off" : k.crossTenantShare}. Group supervision: ${k.masterSupervision === "none" ? "none" : "counts and settings only"}.`}
              </p>
              <StatCounts rows={k.stats} />
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
