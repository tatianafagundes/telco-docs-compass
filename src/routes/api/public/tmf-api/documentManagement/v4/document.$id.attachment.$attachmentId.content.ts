import { createFileRoute } from "@tanstack/react-router";
import { getAttachmentContent } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id/attachment/$attachmentId/content")({
  server: { handlers: { GET: ({ request, params }) => getAttachmentContent(request, params.id, params.attachmentId) } },
});
