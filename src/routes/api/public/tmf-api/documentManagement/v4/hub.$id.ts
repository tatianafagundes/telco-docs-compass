import { createFileRoute } from "@tanstack/react-router";
import { unsubscribe, otherMethods } from "@/services/tmf-gateway";
import { legacy } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/hub/$id")({
  server: { handlers: {
      ...otherMethods(["DELETE"]), DELETE: async ({ request, params }) => legacy(await unsubscribe(request, params.id)) } },
});
