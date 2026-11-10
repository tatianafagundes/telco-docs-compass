import { createFileRoute } from "@tanstack/react-router";
import { issueToken, otherMethods } from "@/services/tmf-gateway";

// OAuth 2.0 client credentials: exchanges a system key for a 15-minute access token.
export const Route = createFileRoute("/api/public/tmf-api/oauth/token")({
  server: { handlers: { ...otherMethods(["POST"]), POST: ({ request }) => issueToken(request) } },
});
