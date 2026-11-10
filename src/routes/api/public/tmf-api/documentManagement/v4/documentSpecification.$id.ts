import { createFileRoute } from "@tanstack/react-router";
import { getSpecification } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/documentSpecification/$id")({
  server: { handlers: { GET: ({ request, params }) => getSpecification(request, params.id) } },
});
