import { createFileRoute } from "@tanstack/react-router";
import { postExtractionResult, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";
export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id/attachment/$attachmentId/extractionResult")({
  server: { handlers: {
      ...otherMethods(["POST"]), POST: async ({ request, params }) => legacy(await postExtractionResult(request, params.id, params.attachmentId)) } },
});
