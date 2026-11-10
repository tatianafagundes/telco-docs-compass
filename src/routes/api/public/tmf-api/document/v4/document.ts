import { createFileRoute } from "@tanstack/react-router";
import { createDocument, listDocuments, otherMethods } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/document/v4/document")({
  server: { handlers: {
      ...otherMethods(["GET", "POST"]), GET: ({ request }) => listDocuments(request), POST: ({ request }) => createDocument(request) } },
});
