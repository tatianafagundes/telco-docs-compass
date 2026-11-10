import { createFileRoute } from "@tanstack/react-router";
import { ConnectedSystems } from "@/components/admin/connected-systems";

export const Route = createFileRoute("/_authenticated/admin/systems")({
  head: () => ({
    meta: [
      { title: "Connected systems · Admin" },
      { name: "description", content: "Connect Order care, Ticket management, CRM and CPQ through the TMF667 Document Management API." },
      { property: "og:title", content: "Connected systems · Admin" },
      { property: "og:description", content: "Connect Order care, Ticket management, CRM and CPQ through the TMF667 Document Management API." },
    ],
  }),
  component: ConnectedSystems,
});
