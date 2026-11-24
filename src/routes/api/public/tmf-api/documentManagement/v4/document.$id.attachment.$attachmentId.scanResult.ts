import { createFileRoute } from "@tanstack/react-router";
import { postScanResult, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";
export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id/attachment/$attachmentId/scanResult")({
  server: { handlers: {
      ...otherMethods(["POST"]), POST: async ({ request, params }) => legacy(await postScanResult(request, params.id, params.attachmentId)) } },
});
