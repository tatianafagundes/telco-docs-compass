import { createFileRoute } from "@tanstack/react-router";
import { deleteDocument, getDocument, patchDocument, otherMethods } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/document/v4/document/$id")({
  server: {
    handlers: {
      ...otherMethods(["GET", "PATCH", "DELETE"]),
      DELETE: ({ request, params }) => deleteDocument(request, params.id),
      GET: ({ request, params }) => getDocument(request, params.id),
      PATCH: ({ request, params }) => patchDocument(request, params.id),
    },
  },
});
