// Two things every server function needs and that used to be copied into each file.
//
// `adminClient` loads the privileged database client only when it is called. The import must stay
// inside the function: a top-level import would pull the server-only module (and its key) into the
// code sent to the browser.
import type { Db } from "@/services/seam-runtime";

export async function adminClient(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Today's date in UTC as yyyy-mm-dd, the form every date rule compares. */
export const todayUtc = (now = new Date()): string => now.toISOString().slice(0, 10);
