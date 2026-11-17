import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
// Called by the managed scheduler every minute: advances queued bulk document changes and does
// the housekeeping (see src/services/scheduled-run.ts). Answers 500 when either part failed.
export const Route = createFileRoute("/api/public/jobs/bulk-documents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runScheduled } = await import("@/services/scheduled-run");
        const result = await runScheduled(supabaseAdmin);
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
