import { createFileRoute } from "@tanstack/react-router";
import { getAttachmentContent, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id/attachment/$attachmentId/content")({
  server: { handlers: {
      ...otherMethods(["GET"]), GET: async ({ request, params }) => legacy(await getAttachmentContent(request, params.id, params.attachmentId)) } },
});
