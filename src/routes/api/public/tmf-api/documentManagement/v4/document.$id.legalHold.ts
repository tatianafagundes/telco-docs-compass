import { createFileRoute } from "@tanstack/react-router";
import { setLegalHold, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id/legalHold")({
  server: { handlers: {
      ...otherMethods(["POST"]), POST: async ({ request, params }) => legacy(await setLegalHold(request, params.id)) } },
});
