import { createFileRoute } from "@tanstack/react-router";
import { getAttachmentContent, otherMethods } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/document/v4/document/$id/attachment/$attachmentId/content")({
  server: { handlers: {
      ...otherMethods(["GET"]), GET: ({ request, params }) => getAttachmentContent(request, params.id, params.attachmentId) } },
});
