import { createFileRoute } from "@tanstack/react-router";
import { getDocument, patchDocument } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => getDocument(request, params.id),
      PATCH: ({ request, params }) => patchDocument(request, params.id),
    },
  },
});
