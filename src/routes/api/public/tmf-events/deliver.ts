import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Called by the managed scheduler every minute; delivers pending document events to subscribers.
export const Route = createFileRoute("/api/public/tmf-events/deliver")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { deliverPending } = await import("@/services/tmf-events");
        const result = await deliverPending(supabaseAdmin, new URL(request.url).origin);
        return Response.json(result);
      },
    },
  },
});
