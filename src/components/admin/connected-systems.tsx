import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, Gauge, KeyRound, Plug, RotateCw, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { tableDate } from "@/lib/table-format";
import { Button } from "@/components/erad/button";
import { Card } from "@/components/erad/card";
import { Checkbox } from "@/components/erad/checkbox";
import { Dialog } from "@/components/erad/dialog";
import { EmptyState } from "@/components/erad/empty-state";
import { Select } from "@/components/erad/select";
import { Tag } from "@/components/erad/tag";
import { TextField } from "@/components/erad/text-field";
import { SystemLimitsDialog } from "@/components/admin/system-limits-dialog";
import { ProcessingSwitch } from "@/components/admin/processing-switch";
import { disconnectWarning, switchKey, withScope } from "@/components/admin/processing-switch-view";
import { canLine, FILTER_FROM, splitSystems } from "@/components/admin/connected-systems-view";
import { failureText } from "@/hooks/use-config";
import { api } from "@/services/api";
import type { ConnectedSystem } from "@/services/integration-clients.functions";
import {
  SCOPES,
  SYSTEM_KINDS,
  TMF_BASE_PATH,
  type Scope,
  type SystemKind,
} from "@/services/tmf667-mapper";

const KIND_LABEL: Record<SystemKind, string> = {
  orderCare: "Order care (TMF622)",
  ticketManagement: "Ticket management (TMF621)",
  crm: "CRM (TMF629 / TMF666)",
  cpq: "CPQ (TMF648)",
  other: "Other system",
};

const SCOPE_LABEL: Record<Scope, string> = {
  read: "Read documents and download files",
  register: "Add documents and change their details",
  transition: "Move documents along their status path",
  approve: "Approve documents (only when every required detail is confirmed)",
  hold: "Place and release legal holds",
  delete: "Delete documents (holds and keep-until dates still apply)",
  subscribe: "Receive change notifications",
  scan: "Check files for threats and report the result",
  extract: "Read details from files and report what it found",
};

const DEFAULT_SCOPES: Record<SystemKind, Scope[]> = {
  orderCare: ["read", "subscribe"],
  ticketManagement: ["read", "register"],
  crm: ["read"],
  cpq: ["read", "register", "transition", "subscribe"],
  other: ["read"],
};

const expiresSoon = (iso: string) => new Date(iso).getTime() - Date.now() < 30 * 86_400_000;

const systemsKey = ["integrationClients", "list"] as const;

export function ConnectedSystems() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: systemsKey, queryFn: () => api.listSystems() });
  const [adding, setAdding] = useState(false);
  // "Connect again" starts the dialog from a disconnected system's kind, name and permissions.
  const [again, setAgain] = useState<ConnectedSystem | null>(null);
  const [shownKey, setShownKey] = useState<{ name: string; key: string } | null>(null);
  const [revoking, setRevoking] = useState<ConnectedSystem | null>(null);
  const [limiting, setLimiting] = useState<ConnectedSystem | null>(null);
  // Shared with the switch card below: the disconnect warning depends on it.
  const sw = useQuery({ queryKey: switchKey, queryFn: () => api.getProcessingSwitch() });

  const rotate = useMutation({
    mutationFn: (s: ConnectedSystem) =>
      api.rotateSystemKey(s.id).then((r) => ({ ...r, name: s.name })),
    onSuccess: (r) => {
      setShownKey({ name: r.name, key: r.key });
      void qc.invalidateQueries({ queryKey: systemsKey });
    },
    onError: (e) => toast.error(failureText(e)),
  });
  const revoke = useMutation({
    mutationFn: (s: ConnectedSystem) => api.revokeSystem(s.id),
    onSuccess: () => {
      setRevoking(null);
      toast.success("Disconnected. The key stopped working straight away.");
      void qc.invalidateQueries({ queryKey: systemsKey });
    },
    onError: (e) => toast.error(failureText(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="type-paragraph-14 max-w-[640px] text-text-secondary">
          Let Order care, Ticket management, CRM or CPQ work with your documents through the TM
          Forum Document Management API (TMF667). Each system gets its own key, sees only this
          organisation, and every action it takes appears in the document's activity.
        </p>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plug aria-hidden="true" />
          Connect a system
        </Button>
      </div>

      {list.isPending ? (
        <p className="type-paragraph-14 text-text-secondary" role="status">
          Loading connected systems…
        </p>
      ) : list.isError ? (
        <Card>
          <div className="flex flex-col items-start gap-2">
            <p className="type-paragraph-14">We couldn't load connected systems just now.</p>
            <Button onClick={() => void list.refetch()}>Try again</Button>
          </div>
        </Card>
      ) : list.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Plug}
            title="No systems connected yet"
            cause="Connect Order care first so it can fetch the approved contract for any order in one call."
          />
        </Card>
      ) : (
        <SystemList
          systems={list.data}
          rotating={rotate.isPending}
          onRotate={(s) => rotate.mutate(s)}
          onLimits={setLimiting}
          onRevoke={setRevoking}
          onConnect={() => setAdding(true)}
          onConnectAgain={(s) => {
            setAgain(s);
            setAdding(true);
          }}
        />
      )}
      {list.data ? <ProcessingSwitch systems={list.data} /> : null}
      <Card title="For your integration team">
        <div className="flex flex-col gap-1">
          <p className="type-paragraph-14">
            Address: <code className="type-code-14">{TMF_BASE_PATH}</code> on this site. Send the
            key as <code className="type-code-14">Authorization: Bearer …</code> and an{" "}
            <code className="type-code-14">Idempotency-Key</code> on every change.
          </p>
          <p className="type-paragraph-14 text-text-secondary">
            Current approved contract for an order:{" "}
            <code className="type-code-14">
              GET /document?relatedEntity.id=ORDER_ID&amp;status=approved,published
            </code>
          </p>
          <p className="type-paragraph-14 text-text-secondary">
            TM Forum TMF667 v4. Each system has its own request limits (usually 120 reads and 30
            changes per minute). Over the limit, it gets 429 with Retry-After and RateLimit headers.
            Systems that use OAuth can swap the key for a 15-minute token at{" "}
            <code className="type-code-14">/api/public/tmf-api/oauth/token</code>. The earlier
            address ending in documentManagement/v4 keeps working until 10 May 2027.
          </p>
        </div>
      </Card>

      <AddSystemDialog
        key={again?.id ?? "new"}
        open={adding}
        from={again}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) setAgain(null);
        }}
        onCreated={(name, key) => {
          setAdding(false);
          setAgain(null);
          setShownKey({ name, key });
          void qc.invalidateQueries({ queryKey: systemsKey });
        }}
      />

      <Dialog
        open={shownKey !== null}
        onOpenChange={(o) => !o && setShownKey(null)}
        title="Copy this key now"
        description={`This is the only time the key for ${shownKey?.name ?? ""} is shown. Store it in that system's secure settings.`}
        actions={
          <Button variant="primary" onClick={() => setShownKey(null)}>
            I've stored it
          </Button>
        }
      >
        <div className="flex items-center gap-2">
          <KeyRound aria-hidden="true" className="size-4 shrink-0 text-text-secondary" />
          <code className="type-code-14 min-w-0 flex-1 break-all" aria-label="System key">
            {shownKey?.key}
          </code>
          <Button
            onClick={() => {
              if (shownKey)
                void navigator.clipboard
                  .writeText(shownKey.key)
                  .then(() => toast.success("Key copied."));
            }}
          >
            <Copy aria-hidden="true" />
            Copy
          </Button>
        </div>
      </Dialog>

      <SystemLimitsDialog
        system={limiting}
        onClose={() => setLimiting(null)}
        onSaved={() => {
          setLimiting(null);
          void qc.invalidateQueries({ queryKey: systemsKey });
        }}
      />

      <Dialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Disconnect ${revoking?.name ?? ""}?`}
        description={[
          "Its key stops working straight away and its change notifications end. Documents it added stay where they are.",
          revoking ? disconnectWarning(revoking, sw.data) : null,
        ]
          .filter(Boolean)
          .join(" ")}
        actions={
          <>
            <Button onClick={() => setRevoking(null)}>Keep connected</Button>
            <Button
              variant="destructive"
              onClick={() => revoking && revoke.mutate(revoking)}
              unavailable={revoke.isPending}
            >
              Disconnect
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}

function AddSystemDialog({
  open,
  from,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  /** A disconnected system to connect again: its old key stays revoked, a new one is issued. */
  from: ConnectedSystem | null;
  onOpenChange: (o: boolean) => void;
  onCreated: (name: string, key: string) => void;
}) {
  const fromKind = (SYSTEM_KINDS as readonly string[]).includes(from?.systemKind ?? "")
    ? (from?.systemKind as SystemKind)
    : null;
  const [kind, setKind] = useState<SystemKind>(fromKind ?? "orderCare");
  const [name, setName] = useState(from?.name ?? "Order care");
  const [scopes, setScopes] = useState<Scope[]>(
    from
      ? (from.scopes.filter((x) => (SCOPES as readonly string[]).includes(x)) as Scope[])
      : DEFAULT_SCOPES.orderCare,
  );
  const create = useMutation({
    mutationFn: () => api.createSystem({ name: name.trim(), systemKind: kind, scopes }),
    onSuccess: (r) => onCreated(r.system.name, r.key),
    onError: (e) => toast.error(failureText(e)),
  });
  const reason =
    name.trim().length < 2
      ? "Give the system a name."
      : scopes.length === 0
        ? "Choose at least one thing it can do."
        : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={from ? `Connect ${from.name} again` : "Connect a system"}
      description={
        from
          ? "It gets a new key; the old one stays disconnected. Its earlier settings are filled in."
          : "Choose only what this system needs. You can disconnect it at any time."
      }
      actions={
        <>
          {reason ? <span className="type-paragraph-14 text-text-secondary">{reason}</span> : null}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            unavailable={reason !== null || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Connecting…" : "Connect and show key"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="System"
          value={kind}
          onValueChange={(v) => {
            const k = v as SystemKind;
            setKind(k);
            setScopes(DEFAULT_SCOPES[k]);
            setName(KIND_LABEL[k].split(" (")[0] ?? KIND_LABEL[k]);
          }}
          groups={[{ options: SYSTEM_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) }]}
        />
        <TextField
          label="Name shown in activity"
          helper="People see this name when a file waits for this system or is blocked by it."
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="type-label-14 mb-1">What it can do</legend>
          <p className="type-label-12 text-text-secondary">
            Checking files and reading files each need a system of their own, with no other
            permission.
          </p>
          {SCOPES.map((s) => (
            <Checkbox
              key={s}
              label={SCOPE_LABEL[s]}
              checked={scopes.includes(s)}
              onCheckedChange={(c) =>
                setScopes((prev) => (c === true ? withScope(prev, s) : prev.filter((x) => x !== s)))
              }
            />
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}

const kindLabel = (k: string) => KIND_LABEL[k as SystemKind] ?? k;
function SystemList(p: {
  systems: ConnectedSystem[];
  rotating: boolean;
  onRotate: (s: ConnectedSystem) => void;
  onLimits: (s: ConnectedSystem) => void;
  onRevoke: (s: ConnectedSystem) => void;
  onConnect: () => void;
  onConnectAgain: (s: ConnectedSystem) => void;
}) {
  const [query, setQuery] = useState("");
  const { connected, disconnected } = splitSystems(p.systems, query, kindLabel);
  const active = p.systems.filter((s) => !s.revokedAt).length;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="systems-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="systems-heading" className="type-title-16-medium">
          {query ? `Connected (${connected.length} of ${active})` : `Connected (${active})`}
        </h2>
        {p.systems.length >= FILTER_FROM ? (
          <div className="w-full max-w-[320px]">
            <TextField
              label="Filter by name or system"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      {connected.length === 0 ? (
        <p className="type-paragraph-14 text-text-secondary">
          {query ? (
            "No connected system matches this filter."
          ) : (
            <span className="flex flex-wrap items-center gap-3">
              No system is connected. Connect a system to start.
              <Button onClick={p.onConnect}>
                <Plug aria-hidden="true" />
                Connect a system
              </Button>
            </span>
          )}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Connected systems">
          {connected.map((s) => (
            <li key={s.id}>
              <Card
                title={s.name}
                actions={
                  <div className="flex gap-2">
                    <Button onClick={() => p.onRotate(s)} unavailable={p.rotating}>
                      <RotateCw aria-hidden="true" />
                      New key
                    </Button>
                    <Button onClick={() => p.onLimits(s)}>
                      <Gauge aria-hidden="true" />
                      Request limits
                    </Button>
                    <Button variant="ghost" onClick={() => p.onRevoke(s)}>
                      <Unplug aria-hidden="true" />
                      Disconnect
                    </Button>
                  </div>
                }
              >
                <div className="flex flex-col gap-2">
                  <span className="type-label-14 text-text-secondary">
                    {kindLabel(s.systemKind)}
                  </span>
                  <p className="type-paragraph-14">
                    Key starting <code className="type-code-14">{s.keyPrefix}…</code> ·{" "}
                    {s.lastUsedAt
                      ? `last used ${format(new Date(s.lastUsedAt), "d MMM yyyy, HH:mm")}`
                      : "not used yet"}
                  </p>
                  {s.expiresAt ? (
                    <p
                      className={cn(
                        "type-paragraph-14",
                        expiresSoon(s.expiresAt) ? "text-status-major" : "text-text-secondary",
                      )}
                    >
                      {new Date(s.expiresAt) <= new Date()
                        ? "This key has expired. You can issue a new key to reconnect."
                        : expiresSoon(s.expiresAt)
                          ? `Key expires ${format(new Date(s.expiresAt), "d MMM yyyy")}. Issue a new key before it expires.`
                          : `Key valid until ${format(new Date(s.expiresAt), "d MMM yyyy")}`}
                    </p>
                  ) : null}
                  <p className="type-paragraph-14 text-text-secondary">
                    Allowance: {s.readLimitPerMinute} reads and {s.writeLimitPerMinute} changes per
                    minute
                  </p>
                  {s.lastRateLimitedAt ? (
                    <p className="type-paragraph-14 text-text-secondary">
                      Last slowed down for sending too many requests:{" "}
                      {format(new Date(s.lastRateLimitedAt), "d MMM yyyy, HH:mm")}
                    </p>
                  ) : null}
                  <p className="type-paragraph-14 text-text-secondary">Can: {canLine(s.scopes)}</p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {disconnected.length > 0 ? (
        // While filtering, matches among disconnected systems are shown, not hidden in the group.
        <details
          key={query ? "filtering" : "all"}
          open={query ? true : undefined}
          className="flex flex-col gap-2"
        >
          <summary className="focus-ring type-label-14 cursor-pointer self-start">
            Disconnected ({disconnected.length})
          </summary>
          <ul className="mt-2 flex flex-col" aria-label="Disconnected systems">
            {disconnected.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2"
              >
                <span className="type-label-14">{s.name}</span>
                <span className="type-label-14 text-text-secondary">{kindLabel(s.systemKind)}</span>
                <Tag small>Disconnected</Tag>
                {s.revokedAt ? (
                  <span className="type-label-12 text-text-secondary">
                    {`Disconnected ${tableDate(s.revokedAt)}`}
                  </span>
                ) : null}
                <Button variant="ghost" className="ml-auto" onClick={() => p.onConnectAgain(s)}>
                  Connect again
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
