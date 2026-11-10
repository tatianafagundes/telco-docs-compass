import { createFileRoute } from "@tanstack/react-router";
import { transitionDocument } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id/transition")({
  server: { handlers: { POST: ({ request, params }) => transitionDocument(request, params.id) } },
});
