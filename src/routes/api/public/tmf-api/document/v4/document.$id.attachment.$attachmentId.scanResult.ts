import { createFileRoute } from "@tanstack/react-router";
import { postScanResult, otherMethods } from "@/services/tmf-gateway";
export const Route = createFileRoute("/api/public/tmf-api/document/v4/document/$id/attachment/$attachmentId/scanResult")({
  server: { handlers: {
      ...otherMethods(["POST"]), POST: ({ request, params }) => postScanResult(request, params.id, params.attachmentId) } },
});
