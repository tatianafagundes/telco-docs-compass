import { createFileRoute } from "@tanstack/react-router";
import { unknownPath } from "@/services/tmf-gateway";

// Any address under the API that isn't a resource answers a TMF 404, not the app page.
export const Route = createFileRoute("/api/public/tmf-api/$")({
  server: { handlers: { GET: unknownPath, POST: unknownPath, PUT: unknownPath, PATCH: unknownPath, DELETE: unknownPath } },
});
