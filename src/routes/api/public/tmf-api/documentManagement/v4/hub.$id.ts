import { createFileRoute } from "@tanstack/react-router";
import { unsubscribe } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/hub/$id")({
  server: { handlers: { DELETE: ({ request, params }) => unsubscribe(request, params.id) } },
});
