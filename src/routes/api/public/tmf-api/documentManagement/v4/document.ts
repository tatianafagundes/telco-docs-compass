import { createFileRoute } from "@tanstack/react-router";
import { createDocument, listDocuments, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/document")({
  server: { handlers: {
      ...otherMethods(["GET", "POST"]), GET: async ({ request }) => legacy(await listDocuments(request)), POST: async ({ request }) => legacy(await createDocument(request)) } },
});
