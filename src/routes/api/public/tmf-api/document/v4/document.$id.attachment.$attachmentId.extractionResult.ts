import { createFileRoute } from "@tanstack/react-router";
import { postExtractionResult, otherMethods } from "@/services/tmf-gateway";
export const Route = createFileRoute("/api/public/tmf-api/document/v4/document/$id/attachment/$attachmentId/extractionResult")({
  server: { handlers: {
      ...otherMethods(["POST"]), POST: ({ request, params }) => postExtractionResult(request, params.id, params.attachmentId) } },
});
