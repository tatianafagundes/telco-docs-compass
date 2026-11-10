import { createFileRoute } from "@tanstack/react-router";
import { getSpecification, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/documentSpecification/$id")({
  server: { handlers: {
      ...otherMethods(["GET"]), GET: async ({ request, params }) => legacy(await getSpecification(request, params.id)) } },
});
