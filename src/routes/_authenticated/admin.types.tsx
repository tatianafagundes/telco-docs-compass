import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/erad/banner";
import { Button } from "@/components/erad/button";
import { Dialog } from "@/components/erad/dialog";
import { SidePanel } from "@/components/erad/side-panel";
import { TextField } from "@/components/erad/text-field";
import { SpecPanel, type Draft } from "@/components/admin/spec-panel";
import { SpecTable } from "@/components/admin/spec-table";
import { configQuery, failureText } from "@/hooks/use-config";
import { useMe } from "@/hooks/use-me";
import { api } from "@/services/api";

export const Route = createFileRoute("/_authenticated/admin/types")({
  head: () => ({
    meta: [
      { title: "Document types · Admin" },
      { name: "description", content: "Document types this organisation uses, and where each setting comes from." },
      { property: "og:title", content: "Document types · Admin" },
      { property: "og:description", content: "Document types this organisation uses, and where each setting comes from." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(configQuery),
  component: TypesPage,
});

function TypesPage() {
  const { data: view } = useSuspenseQuery(configQuery);
  const me = useMe();
  const role = me.access?.role === "master_admin" ? "master_admin" : "tenant_admin";
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [lockDraft, setLockDraft] = useState<boolean | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const spec = view.specs.find((s) => s.code === open);
  const dirty = Object.keys(draft).length > 0 || lockDraft !== undefined;
  const mode = view.tenant.inheritance["documentSpecifications"]?.mode;
  const canAdd = view.tenant.isGroup || mode === "extend" || mode === "override";

  const refresh = () => qc.invalidateQueries({ queryKey: ["config"] });
  const save = useMutation({
    mutationFn: () => api.saveSpecification({ code: open ?? "", changes: draft, ...(lockDraft !== undefined ? { locked: lockDraft } : {}) }),
    onSuccess: () => { toast.success("Settings saved"); setDraft({}); setLockDraft(undefined); setError(null); void refresh(); },
    onError: (e) => setError(failureText(e)),
  });
  const reset = useMutation({
    mutationFn: (code: string) => api.resetSpecification({ code }),
    onSuccess: () => { toast.success("Group settings apply again"); setDraft({}); void refresh(); },
    onError: (e) => toast.error(failureText(e)),
  });
  const add = useMutation({
    mutationFn: () => api.saveSpecification({ code: newCode, name: newName, changes: {} }),
    onSuccess: () => { toast.success("Document type added"); setAdding(false); setOpen(newCode); setNewCode(""); setNewName(""); void refresh(); },
    onError: (e) => toast.error(failureText(e)),
  });

  function openSpec(code: string) {
    if (dirty && code !== open) {
      toast("Save or discard your changes first");
      return;
    }
    setOpen(code);
  }

  return (
    <div className="flex flex-col gap-4">
      {dirty ? (
        <div role="region" aria-label="Unsaved changes" className="sticky top-0 z-10 flex items-center gap-2 border border-border-item bg-item p-2">
          <span className="type-label-14-medium flex-1">Unsaved changes</span>
          <Button onClick={() => { setDraft({}); setLockDraft(undefined); setError(null); }}>Discard</Button>
          <Button variant="primary" onClick={() => save.mutate()} unavailable={save.isPending}>Save</Button>
        </div>
      ) : null}
      {error ? <Banner tone="critical" status="Not saved">{error}</Banner> : null}
      <div className="flex items-center justify-between gap-2">
        <p className="type-paragraph-14 text-text-secondary">
          {view.tenant.isGroup
            ? "Types defined here are shared with every country in the group."
            : `Types come from ${view.tenant.groupName}. You can see where each setting is defined.`}
        </p>
        {canAdd ? <Button onClick={() => setAdding(true)}>Add a document type</Button> : null}
      </div>
      <div className="relative flex min-h-[480px] gap-0">
        <div className="min-w-0 flex-1">
          <SpecTable view={view} {...(open ? { activeCode: open } : {})} onOpen={openSpec} />
        </div>
        {spec ? (
          <SidePanel title="Document type" collapsed={false} onCollapsedChange={() => { if (!dirty) setOpen(null); }}>
            <SpecPanel
              view={view}
              spec={spec}
              draft={draft}
              lockDraft={lockDraft}
              readOnly={false}
              role={role}
              onChange={(f, v) => setDraft((d) => ({ ...d, [f]: v }))}
              onLock={setLockDraft}
              onReset={() => reset.mutate(spec.code)}
            />
          </SidePanel>
        ) : null}
      </div>
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a document type"
        description="The new type starts with no settings. You can fill them in after adding it."
        actions={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" unavailable={!newName.trim() || !/^[a-zA-Z][a-zA-Z0-9]{1,40}$/.test(newCode)} onClick={() => add.mutate()}>
              Add type
            </Button>
          </>
        }
      >
        <TextField label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <TextField label="Code" helper="Letters and numbers, for example siteSurvey." value={newCode} onChange={(e) => setNewCode(e.target.value)} />
      </Dialog>
    </div>
  );
}
