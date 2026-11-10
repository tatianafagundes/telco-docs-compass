// Test helper for e2e/tmf-events.py. Runs locally with the service role; never shipped to the app.
//   bun e2e/events-helper.ts deliver                 one delivery pass (same code the scheduled route runs)
//   bun e2e/events-helper.ts mint <tenant> <name> <scopes,comma>   temporary system key → {"id","key"}
//   bun e2e/events-helper.ts revoke <clientId>       disconnect a temporary system (removes its subscriptions)
//   bun e2e/events-helper.ts due-now <subId...>      make pending retries for these subscriptions due now
//   bun e2e/events-helper.ts status <subId>          delivery records for a subscription
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deliverPending } from "@/services/tmf-events";
import { sha256Hex } from "@/services/tmf667-mapper";

const [cmd, ...args] = process.argv.slice(2);
const admin = supabaseAdmin;

async function main(): Promise<unknown> {
  switch (cmd) {
    case "deliver":
      return deliverPending(admin, process.env.BASE_URL ?? "http://localhost:8080");
    case "mint": {
      const [tenant, name, scopes] = args;
      const bytes = crypto.getRandomValues(new Uint8Array(30));
      const key = `erad_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
      const { data, error } = await admin
        .from("integration_clients")
        .insert({ tenant_id: tenant ?? "", name: name ?? "TMF test", system_kind: "other", scopes: (scopes ?? "read").split(","), key_prefix: key.slice(0, 10), key_hash: await sha256Hex(key), expires_at: new Date(Date.now() + 86_400_000).toISOString() })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: data.id, key };
    }
    case "revoke":
      await admin.from("event_subscriptions").delete().eq("client_id", args[0] ?? "");
      await admin.from("integration_clients").update({ revoked_at: new Date().toISOString() }).eq("id", args[0] ?? "");
      return { ok: true };
    case "due-now": {
      const { data } = await admin
        .from("event_deliveries")
        .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
        .in("subscription_id", args)
        .is("delivered_at", null)
        .is("gave_up_at", null)
        .select("event_id");
      return { made_due: data?.length ?? 0 };
    }
    case "status": {
      const { data } = await admin
        .from("event_deliveries")
        .select("event_id, attempts, next_attempt_at, delivered_at, gave_up_at, last_status, last_error")
        .eq("subscription_id", args[0] ?? "")
        .order("event_id");
      return data ?? [];
    }
    default:
      throw new Error(`unknown command ${cmd ?? ""}`);
  }
}

console.log(JSON.stringify(await main()));
