import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/erad/page-header";
import { EmptyState } from "@/components/erad/empty-state";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin · Documents" },
      { name: "description", content: "Tenant settings, document types and retention rules." },
      { property: "og:title", content: "Admin · Documents" },
      { property: "og:description", content: "Tenant settings, document types and retention rules." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  return (
    <div>
      <PageHeader title="Admin" />
      <EmptyState
        icon={Settings}
        title="Settings arrive in a later build"
        cause="Document types, retention rules and tenant policy will be managed here."
      />
    </div>
  );
}
