// Small helpers the document server functions share: the privileged client, today, the common
// error shape, loading one document, and the document column list.
//
// Does not define any server function: see document-read, -content, -status, -review and -access.
import type { Json } from "@/integrations/supabase/types";
import { seamError, type SeamErr, type SpecCharacteristic } from "@/services/document-rules";
import { type Db } from "@/services/seam-runtime";
import { adminClient, todayUtc } from "@/services/shared/server-context";
export { adminClient };
export const BUCKET = "documents";

export interface UploadTicket {
  versionId: string;
  method: "signedUrl";
  url: string;
  token: string;
  expiresAt: string;
}
export type ContentResult =
  | { kind: "sample"; mimeType: string; pages: Json; previewable: boolean }
  | { kind: "signed"; url: string; expiresAt: string; mimeType: string; previewable: boolean };
export const DOC_COLUMNS =
  "id, tenant_id, name, document_type, status, pipeline_state, pipeline_detail, sensitivity, signature_level, effective_date, valid_to, expiry_date, legal_hold, hold_reason, retain_until, characteristic, current_version_id, created_by, created_at, updated_at";

export const today = () => todayUtc();
export const fail = (
  code: string,
  category: Parameters<typeof seamError>[1],
  next?: Parameters<typeof seamError>[2],
  detail?: string,
): SeamErr => ({
  ok: false,
  error: seamError(code, category, next, detail),
});

export async function loadDoc(db: Db, id: string) {
  const { data } = await db.from("documents").select(DOC_COLUMNS).eq("id", id).maybeSingle();
  return data;
}

export async function specFor(caller: Db, code: string): Promise<SpecCharacteristic[]> {
  const { data } = await caller.rpc("effective_specifications");
  const spec = (data ?? []).find((s) => s.code === code);
  const def = spec?.definition as { specCharacteristic?: SpecCharacteristic[] } | null | undefined;
  return def?.specCharacteristic ?? [];
}
