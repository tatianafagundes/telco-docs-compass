import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PolicyCards } from "@/components/admin/policy-cards";
import { configQuery } from "@/hooks/use-config";

export const Route = createFileRoute("/_authenticated/admin/policies")({
  head: () => ({
    meta: [
      { title: "Policies · Admin" },
      { name: "description", content: "How this organisation relates to the group's retention, sensitivity, access and approval settings." },
      { property: "og:title", content: "Policies · Admin" },
      { property: "og:description", content: "How this organisation relates to the group's retention, sensitivity, access and approval settings." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(configQuery),
  component: PoliciesPage,
});

function PoliciesPage() {
  const { data } = useSuspenseQuery(configQuery);
  return <PolicyCards tenant={data.tenant} />;
}
