import { createFileRoute } from "@tanstack/react-router";
import { subscribe } from "@/services/tmf-gateway";

export const Route = createFileRoute("/api/public/tmf-api/documentManagement/v4/hub")({
  server: { handlers: { POST: ({ request }) => subscribe(request) } },
});
