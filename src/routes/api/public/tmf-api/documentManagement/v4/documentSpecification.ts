import { createFileRoute } from "@tanstack/react-router";
import { listSpecifications } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/documentSpecification")({
  server: { handlers: { GET: ({ request }) => listSpecifications(request) } },
});
