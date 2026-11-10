import { createFileRoute } from "@tanstack/react-router";
import { transitionDocument, otherMethods } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/document/v4/document/$id/transition")({
  server: { handlers: {
      ...otherMethods(["POST"]), POST: ({ request, params }) => transitionDocument(request, params.id) } },
});
