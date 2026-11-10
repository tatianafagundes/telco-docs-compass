import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, KeyRound, Plug, RotateCw, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { Card } from "@/components/erad/card";
import { Checkbox } from "@/components/erad/checkbox";
import { Dialog } from "@/components/erad/dialog";
import { EmptyState } from "@/components/erad/empty-state";
import { Select } from "@/components/erad/select";
import { Tag } from "@/components/erad/tag";
import { TextField } from "@/components/erad/text-field";
import { failureText } from "@/hooks/use-config";
import { api } from "@/services/api";
import type { ConnectedSystem } from "@/services/integration-clients.functions";
import { SCOPES, SYSTEM_KINDS, TMF_BASE_PATH, type Scope, type SystemKind } from "@/services/tmf667-mapper";

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
  subscribe: "Receive change notifications",
};

const DEFAULT_SCOPES: Record<SystemKind, Scope[]> = {
  orderCare: ["read", "subscribe"],
  ticketManagement: ["read", "register"],
  crm: ["read"],
  cpq: ["read", "register", "transition", "subscribe"],
  other: ["read"],
};

const systemsKey = ["integrationClients", "list"] as const;

export function ConnectedSystems() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: systemsKey, queryFn: () => api.listSystems() });
  const [adding, setAdding] = useState(false);
  const [shownKey, setShownKey] = useState<{ name: string; key: string } | null>(null);
  const [revoking, setRevoking] = useState<ConnectedSystem | null>(null);

  const rotate = useMutation({
    mutationFn: (s: ConnectedSystem) => api.rotateSystemKey(s.id).then((r) => ({ ...r, name: s.name })),
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
          Let Order care, Ticket management, CRM or CPQ work with your documents through the TM Forum Document Management API (TMF667). Each system gets its own key, sees only this organisation, and every action it takes appears in the document's activity.
        </p>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plug aria-hidden="true" />
          Connect a system
        </Button>
      </div>

      {list.isPending ? (
        <p className="type-paragraph-14 text-text-secondary" role="status">Loading connected systems…</p>
      ) : list.isError ? (
        <Card>
          <div className="flex flex-col items-start gap-2">
            <p className="type-paragraph-14">We couldn't load connected systems just now.</p>
            <Button onClick={() => void list.refetch()}>Try again</Button>
          </div>
        </Card>
      ) : list.data.length === 0 ? (
        <Card>
          <EmptyState icon={Plug} title="No systems connected yet" cause="Connect Order care first so it can fetch the approved contract for any order in one call." />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Connected systems">
          {list.data.map((s) => (
            <li key={s.id}>
              <Card
                title={s.name}
                actions={
                  s.revokedAt ? null : (
                    <div className="flex gap-2">
                      <Button onClick={() => rotate.mutate(s)} unavailable={rotate.isPending}>
                        <RotateCw aria-hidden="true" />
                        New key
                      </Button>
                      <Button variant="ghost" onClick={() => setRevoking(s)}>
                        <Unplug aria-hidden="true" />
                        Disconnect
                      </Button>
                    </div>
                  )
                }
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-label-14 text-text-secondary">{KIND_LABEL[s.systemKind as SystemKind] ?? s.systemKind}</span>
                    {s.revokedAt ? <Tag tone="critical" small>Disconnected</Tag> : <Tag tone="cleared" small>Connected</Tag>}
                  </div>
                  <p className="type-paragraph-14">
                    Key starting <code className="type-code-14">{s.keyPrefix}…</code> ·{" "}
                    {s.lastUsedAt ? `last used ${format(new Date(s.lastUsedAt), "d MMM yyyy, HH:mm")}` : "not used yet"}
                  </p>
                  <p className="type-paragraph-14 text-text-secondary">Can: {s.scopes.map((x) => SCOPE_LABEL[x as Scope]?.split(" (")[0].toLowerCase() ?? x).join(" · ")}</p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card title="For your integration team">
        <div className="flex flex-col gap-1">
          <p className="type-paragraph-14">
            Address: <code className="type-code-14">{TMF_BASE_PATH}</code> on this site. Send the key as <code className="type-code-14">Authorization: Bearer …</code> and an <code className="type-code-14">Idempotency-Key</code> on every change.
          </p>
          <p className="type-paragraph-14 text-text-secondary">
            Current approved contract for an order: <code className="type-code-14">GET /document?relatedEntity.id=ORDER_ID&amp;lifecycleState=approved,effective</code>
          </p>
        </div>
      </Card>

      <AddSystemDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(name, key) => {
          setAdding(false);
          setShownKey({ name, key });
          void qc.invalidateQueries({ queryKey: systemsKey });
        }}
      />

      <Dialog
        open={shownKey !== null}
        onOpenChange={(o) => !o && setShownKey(null)}
        title="Copy this key now"
        description={`This is the only time the key for ${shownKey?.name ?? ""} is shown. Store it in that system's secure settings.`}
        actions={<Button variant="primary" onClick={() => setShownKey(null)}>I've stored it</Button>}
      >
        <div className="flex items-center gap-2">
          <KeyRound aria-hidden="true" className="size-4 shrink-0 text-text-secondary" />
          <code className="type-code-14 min-w-0 flex-1 break-all" aria-label="System key">{shownKey?.key}</code>
          <Button
            onClick={() => {
              if (shownKey) void navigator.clipboard.writeText(shownKey.key).then(() => toast.success("Key copied."));
            }}
          >
            <Copy aria-hidden="true" />
            Copy
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Disconnect ${revoking?.name ?? ""}?`}
        description="Its key stops working straight away and its change notifications end. Documents it added stay where they are."
        actions={
          <>
            <Button onClick={() => setRevoking(null)}>Keep connected</Button>
            <Button variant="destructive" onClick={() => revoking && revoke.mutate(revoking)} unavailable={revoke.isPending}>
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

function AddSystemDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (name: string, key: string) => void }) {
  const [kind, setKind] = useState<SystemKind>("orderCare");
  const [name, setName] = useState("Order care");
  const [scopes, setScopes] = useState<Scope[]>(DEFAULT_SCOPES.orderCare);
  const create = useMutation({
    mutationFn: () => api.createSystem({ name: name.trim(), systemKind: kind, scopes }),
    onSuccess: (r) => onCreated(r.system.name, r.key),
    onError: (e) => toast.error(failureText(e)),
  });
  const reason = name.trim().length < 2 ? "Give the system a name." : scopes.length === 0 ? "Choose at least one thing it can do." : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect a system"
      description="Choose only what this system needs. You can disconnect it at any time."
      actions={
        <>
          {reason ? <span className="type-paragraph-14 text-text-secondary">{reason}</span> : null}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" unavailable={reason !== null || create.isPending} onClick={() => create.mutate()}>
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
            setName(KIND_LABEL[k].split(" (")[0]);
          }}
          groups={[{ options: SYSTEM_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) }]}
        />
        <TextField label="Name shown in activity" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <fieldset className="flex flex-col gap-2">
          <legend className="type-label-14 mb-1">What it can do</legend>
          {SCOPES.map((s) => (
            <Checkbox
              key={s}
              label={SCOPE_LABEL[s]}
              checked={scopes.includes(s)}
              onCheckedChange={(c) => setScopes((prev) => (c === true ? [...prev, s] : prev.filter((x) => x !== s)))}
            />
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}
