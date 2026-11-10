import { createFileRoute } from "@tanstack/react-router";
import { listSpecifications, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/documentSpecification")({
  server: { handlers: {
      ...otherMethods(["GET"]), GET: async ({ request }) => legacy(await listSpecifications(request)) } },
});
