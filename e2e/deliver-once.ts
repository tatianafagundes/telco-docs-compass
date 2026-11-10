// Test helper: runs one event-delivery pass directly (same code the scheduled route runs).
// Used by e2e/tmf-api.py when the managed scheduler is not delivering (e.g. app not yet published).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deliverPending } from "@/services/tmf-events";

const origin = process.env.BASE_URL ?? "http://localhost:8080";
const result = await deliverPending(supabaseAdmin, origin);
console.log(JSON.stringify(result));
