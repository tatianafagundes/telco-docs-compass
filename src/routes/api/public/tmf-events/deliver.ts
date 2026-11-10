import { createFileRoute } from "@tanstack/react-router";

// Called by the scheduler. Requires the delivery secret; compares in constant time.
export const Route = createFileRoute("/api/public/tmf-events/deliver")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["TMF_DELIVERY_SECRET"] ?? "";
        const got = request.headers.get("x-delivery-secret") ?? "";
        let diff = expected.length === got.length && expected.length > 0 ? 0 : 1;
        for (let i = 0; i < Math.min(expected.length, got.length); i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
        if (diff !== 0) return new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { deliverPending } = await import("@/services/tmf-events");
        const result = await deliverPending(supabaseAdmin, new URL(request.url).origin);
        return Response.json(result);
      },
    },
  },
});
