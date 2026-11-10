import { createFileRoute } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/erad/empty-state";
import { PageHeader } from "@/components/erad/page-header";
import { HoldsPage } from "@/components/holds/holds-page";
import { useMe } from "@/hooks/use-me";
import { can, type AppRole } from "@/services/document-rules";

export const Route = createFileRoute("/_authenticated/holds")({
  head: () => ({
    meta: [
      { title: "Holds and retention · Documents" },
      { name: "description", content: "Legal holds, retention policies in force and deletion history." },
      { property: "og:title", content: "Holds and retention · Documents" },
      { property: "og:description", content: "Legal holds, retention policies in force and deletion history." },
    ],
  }),
  component: ManagerHolds,
});

function ManagerHolds() {
  const me = useMe();
  const role = me.access?.role as AppRole | undefined;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Holds and retention" />
      {role && can(role, "manage") ? (
        <HoldsPage />
      ) : (
        <EmptyState icon={Lock} title="Holds are managed by managers" cause="Your role lets you see when a document is on hold. A manager can place or release holds." />
      )}
    </div>
  );
}
