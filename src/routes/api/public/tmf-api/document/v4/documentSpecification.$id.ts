import { createFileRoute } from "@tanstack/react-router";
import { getSpecification, otherMethods } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/document/v4/documentSpecification/$id")({
  server: { handlers: {
      ...otherMethods(["GET"]), GET: ({ request, params }) => getSpecification(request, params.id) } },
});
