import { createFileRoute } from "@tanstack/react-router";
import { transitionDocument, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id/transition")({
  server: { handlers: {
      ...otherMethods(["POST"]), POST: async ({ request, params }) => legacy(await transitionDocument(request, params.id)) } },
});
