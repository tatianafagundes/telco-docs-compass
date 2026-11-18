// Our internal events mapped to TMF667 v4 events, and the matching of events to subscriptions.
// Pure: no I/O.
import type { DocStatus } from "@/schemas/document";
import { TMF_BASE_PATH, toTmfStatus } from "@/services/tmf667-shared";
/** Internal outbox kinds → TMF667 v4 event names. */
const V4_EVENT: Record<string, string> = {
  DocumentCreateEvent: "DocumentCreateEvent",
  DocumentStateChangeEvent: "DocumentChangeEvent",
  DocumentAttributeValueChangeEvent: "DocumentChangeEvent",
  DocumentDeleteEvent: "DocumentDeleteEvent",
};
export const V4_EVENT_TYPES = [
  "DocumentCreateEvent",
  "DocumentChangeEvent",
  "DocumentBatchEvent",
  "DocumentDeleteEvent",
] as const;
const LEGACY_ONLY = ["DocumentStateChangeEvent", "DocumentAttributeValueChangeEvent"];

export function v4EventType(internal: string): string {
  return V4_EVENT[internal] ?? internal;
}

/** Subscriptions that name an old event type keep receiving the old name until the legacy sunset. */
export function eventNameFor(query: string | null, internal: string): string {
  const wanted = parseEventTypes(query);
  if (wanted && wanted.includes(internal) && LEGACY_ONLY.includes(internal)) return internal;
  return v4EventType(internal);
}

function parseEventTypes(query: string | null): string[] | null {
  if (!query) return null;
  const m = /eventType=([A-Za-z,]+)/.exec(query);
  return m ? (m[1] ?? "").split(",") : null;
}

function queryValue(query: string, key: string): string[] | null {
  const m = new RegExp(`(?:^|[&;])${key.replace(".", "\\.")}=([^&;]+)`).exec(query);
  return m ? decodeURIComponent(m[1] ?? "").split(",") : null;
}

/**
 * TMF667 v4 event envelope. Carries a reference (id, href, status), never document content
 * or characteristic values: receivers fetch the resource with their own key.
 */
export function toTmfEvent(
  origin: string,
  row: {
    id: number;
    event_type: string;
    document_id: string;
    created_at: string;
    payload: unknown;
  },
  query: string | null = null,
) {
  const p = (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as {
    lifecycleState?: string;
    previous?: string;
    documentIds?: unknown;
    action?: unknown;
  };
  if (row.event_type === "DocumentBatchEvent") {
    const ids = Array.isArray(p.documentIds)
      ? p.documentIds.filter((x): x is string => typeof x === "string")
      : [];
    return {
      eventId: String(row.id),
      eventTime: row.created_at,
      timeOcurred: row.created_at,
      eventType: "DocumentBatchEvent",
      correlationId: `batch-${row.id}`,
      domain: "documentManagement",
      title: "Document batch event",
      description: `Bulk change to ${ids.length} document(s)`,
      priority: "normal",
      event: {
        document: ids.map((id) => ({
          id,
          href: `${origin}${TMF_BASE_PATH}/document/${id}`,
          "@type": "Document",
        })),
      },
    };
  }
  const eventType = eventNameFor(query, row.event_type);
  const state = p.lifecycleState as DocStatus | undefined;
  const changed =
    row.event_type === "DocumentStateChangeEvent"
      ? ["status"]
      : row.event_type === "DocumentAttributeValueChangeEvent"
        ? ["attachment", "characteristic", "legalHold"]
        : undefined;
  return {
    eventId: String(row.id),
    eventTime: row.created_at,
    timeOcurred: row.created_at,
    eventType,
    correlationId: row.document_id,
    domain: "documentManagement",
    title: eventType.replace(/([a-z])([A-Z])/g, "$1 $2"),
    description: changed
      ? `Changed: ${changed.join(", ")}`
      : eventType.replace(/([a-z])([A-Z])/g, "$1 $2"),
    priority: "normal",
    event: {
      document: {
        id: row.document_id,
        href: `${origin}${TMF_BASE_PATH}/document/${row.document_id}`,
        "@type": "Document",
        ...(row.event_type === "DocumentDeleteEvent"
          ? { status: "deleted" }
          : state
            ? { status: toTmfStatus(state), lifecycleState: state }
            : {}),
      },
    },
    ...(changed ? { changedAttributes: changed } : {}),
  };
}

/**
 * Event subscription query (TMF630 style): eventType=A,B plus optional document filters
 * status=… and documentType=…. Old and new event names both match.
 */
export function eventMatches(
  query: string | null,
  eventType: string,
  doc?: { status?: DocStatus | null; documentType?: string | null },
): boolean {
  const types = parseEventTypes(query);
  // Batch events go only to subscriptions that ask for them by name.
  if (eventType === "DocumentBatchEvent") return !!types && types.includes("DocumentBatchEvent");
  if (!query) return true;
  if (types && !types.includes(eventType) && !types.includes(v4EventType(eventType))) return false;
  const status = queryValue(query, "status");
  if (status && doc?.status && !status.includes(toTmfStatus(doc.status))) return false;
  const dt = queryValue(query, "documentType");
  if (dt && doc?.documentType && !dt.includes(doc.documentType)) return false;
  return true;
}
