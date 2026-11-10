import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Called by the managed scheduler every minute; advances queued bulk document changes.
export const Route = createFileRoute("/api/public/jobs/bulk-documents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processBulkJobs } = await import("@/services/bulk-worker");
        // A few rounds per call keeps large jobs moving without hitting the request time limit.
        let n = 0;
        for (let i = 0; i < 3; i++) n += await processBulkJobs(supabaseAdmin);
        return Response.json({ processed: n });
      },
    },
  },
});
