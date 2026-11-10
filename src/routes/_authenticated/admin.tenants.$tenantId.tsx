import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Banner } from "@/components/erad/banner";
import { SidePanel } from "@/components/erad/side-panel";
import { PolicyCards } from "@/components/admin/policy-cards";
import { SpecPanel } from "@/components/admin/spec-panel";
import { SpecTable } from "@/components/admin/spec-table";
import { StatCounts } from "@/components/admin/stat-counts";
import { childViewQuery } from "@/hooks/use-config";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/_authenticated/admin/tenants/$tenantId")({
  head: () => ({
    meta: [
      { title: "Organisation settings · Admin" },
      { name: "description", content: "Read-only settings and document counts for one organisation in the group." },
      { property: "og:title", content: "Organisation settings · Admin" },
      { property: "og:description", content: "Read-only settings and document counts for one organisation in the group." },
    ],
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(childViewQuery(params.tenantId)),
  errorComponent: () => (
    <p className="type-paragraph-14" role="status">
      This organisation isn't available to you. <Link to="/admin/tenants" className="underline">Back to tenants</Link>
    </p>
  ),
  component: ChildView,
});

function ChildView() {
  const { tenantId } = Route.useParams();
  const { data: view } = useSuspenseQuery(childViewQuery(tenantId));
  const me = useMe();
  const [open, setOpen] = useState<string | null>(null);
  const spec = view.specs.find((s) => s.code === open);
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="purple" status="Read-only" action={<Link to="/admin/tenants" className="focus-ring type-label-14 underline">Back to tenants</Link>}>
        {`Viewing ${view.tenant.displayName} as ${me.access?.tenantName ?? view.tenant.groupName} – counts and settings only`}
      </Banner>
      <section className="flex flex-col gap-2">
        <h3 className="type-title-16-medium">Documents</h3>
        <StatCounts rows={view.stats} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="type-title-16-medium">Policies</h3>
        <PolicyCards tenant={view.tenant} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="type-title-16-medium">Document types</h3>
        <div className="relative flex min-h-[320px]">
          <div className="min-w-0 flex-1"><SpecTable view={view} {...(open ? { activeCode: open } : {})} onOpen={setOpen} /></div>
          {spec ? (
            <SidePanel title="Document type" collapsed={false} onCollapsedChange={() => setOpen(null)}>
              <SpecPanel view={view} spec={spec} draft={{}} lockDraft={undefined} readOnly role="master_admin" onChange={() => {}} onLock={() => {}} onReset={() => {}} />
            </SidePanel>
          ) : null}
        </div>
      </section>
    </div>
  );
}
