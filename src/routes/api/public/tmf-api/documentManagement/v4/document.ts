import { createFileRoute } from "@tanstack/react-router";
import { createDocument, listDocuments } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document")({
  server: { handlers: { GET: ({ request }) => listDocuments(request), POST: ({ request }) => createDocument(request) } },
});
