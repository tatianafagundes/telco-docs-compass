import { createFileRoute } from "@tanstack/react-router";
import { subscribe, otherMethods } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/hub")({
  server: { handlers: {
      ...otherMethods(["POST"]), POST: ({ request }) => subscribe(request) } },
});
