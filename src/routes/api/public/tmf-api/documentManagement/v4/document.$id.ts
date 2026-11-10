import { createFileRoute } from "@tanstack/react-router";
import { getDocument, patchDocument, otherMethods } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id")({
  server: {
    handlers: {
      ...otherMethods(["GET", "PATCH"]),
      GET: ({ request, params }) => getDocument(request, params.id),
      PATCH: ({ request, params }) => patchDocument(request, params.id),
    },
  },
});
