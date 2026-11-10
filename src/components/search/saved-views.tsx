import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { Checkbox } from "@/components/erad/checkbox";
import { Dialog } from "@/components/erad/dialog";
import { Pill } from "@/components/erad/pill";
import { TextField } from "@/components/erad/text-field";
import { failureText } from "@/hooks/use-config";
import { useSavedViews } from "@/hooks/use-document-search";
import { api } from "@/services/api";
import { hasAnyFilter, type SearchFilters } from "@/services/search-rules";

/** Personal views for everyone; team views are created by country admins. */
export function SavedViews({ filters, isAdmin, onApply }: { filters: SearchFilters; isAdmin: boolean; onApply: (f: SearchFilters) => void }) {
  const qc = useQueryClient();
  const views = useSavedViews();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const save = useMutation({
    mutationFn: () => api.saveView({ name: name.trim(), filters, shared }),
    onSuccess: () => {
      setSaving(false);
      setName("");
      toast.success("View saved.");
      void qc.invalidateQueries({ queryKey: ["savedViews"] });
    },
    onError: (e) => toast.error(failureText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteView(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["savedViews"] }),
    onError: (e) => toast.error(failureText(e)),
  });

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Saved views" role="group">
      {(views.data ?? []).map((v) => (
        <Pill
          key={v.id}
          label={v.shared ? `${v.name} · team` : v.name}
          selected={false}
          onToggle={() => onApply(v.filters)}
          {...(v.mine || isAdmin ? { onRemove: () => remove.mutate(v.id), removeLabel: `Remove view ${v.name}` } : {})}
        />
      ))}
      {hasAnyFilter(filters) ? (
        <Button variant="ghost" onClick={() => setSaving(true)}>
          <Bookmark aria-hidden="true" />
          Save this view
        </Button>
      ) : null}
      <Dialog
        open={saving}
        onOpenChange={setSaving}
        title="Save this view"
        description="Keeps the search and filters so you can come back in one click."
        actions={
          <>
            <Button onClick={() => setSaving(false)}>Cancel</Button>
            <Button variant="primary" unavailable={name.trim().length === 0 || save.isPending} onClick={() => save.mutate()}>
              Save view
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Contracts waiting for review" />
          {isAdmin ? <Checkbox label="Share with everyone in this organisation" checked={shared} onCheckedChange={(c) => setShared(c === true)} /> : null}
        </div>
      </Dialog>
    </div>
  );
}
