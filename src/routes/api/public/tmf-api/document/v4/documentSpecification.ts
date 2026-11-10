import { createFileRoute } from "@tanstack/react-router";
import { listSpecifications, otherMethods } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/document/v4/documentSpecification")({
  server: { handlers: {
      ...otherMethods(["GET"]), GET: ({ request }) => listSpecifications(request) } },
});
