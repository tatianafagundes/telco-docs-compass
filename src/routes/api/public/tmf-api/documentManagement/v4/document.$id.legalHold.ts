import { createFileRoute } from "@tanstack/react-router";
import { setLegalHold } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id/legalHold")({
  server: { handlers: { POST: ({ request, params }) => setLegalHold(request, params.id) } },
});
