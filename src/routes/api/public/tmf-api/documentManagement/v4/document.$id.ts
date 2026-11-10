import { createFileRoute } from "@tanstack/react-router";
import { deleteDocument, getDocument, patchDocument, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document/$id")({
  server: {
    handlers: {
      ...otherMethods(["GET", "PATCH", "DELETE"]),
      DELETE: async ({ request, params }) => legacy(await deleteDocument(request, params.id)),
      GET: async ({ request, params }) => legacy(await getDocument(request, params.id)),
      PATCH: async ({ request, params }) => legacy(await patchDocument(request, params.id)),
    },
  },
});
