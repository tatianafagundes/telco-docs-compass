import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { FileText, Inbox, History, Sparkles, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { TextField } from "@/components/erad/text-field";
import { Select } from "@/components/erad/select";
import { Checkbox } from "@/components/erad/checkbox";
import { RadioGroup } from "@/components/erad/radio-group";
import { Tag } from "@/components/erad/tag";
import { Pill } from "@/components/erad/pill";
import { Tooltip } from "@/components/erad/tooltip";
import { DataTable } from "@/components/erad/data-table";
import { Card } from "@/components/erad/card";
import { SidePanel } from "@/components/erad/side-panel";
import { Dialog } from "@/components/erad/dialog";
import { NavTabs, TextTabs } from "@/components/erad/tabs";
import { Breadcrumb } from "@/components/erad/breadcrumb";
import { EmptyState } from "@/components/erad/empty-state";
import { Banner } from "@/components/erad/banner";
import { Avatar, Divider, ProgressBar, Skeleton, SkeletonRow, Spinner } from "@/components/erad/misc";

// Dev-only review page for every ERAD primitive and state.
export const Route = createFileRoute("/design")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Design review · Documents" },
      { name: "description", content: "Every ERAD primitive and state in light and dark." },
      { property: "og:title", content: "Design review · Documents" },
      { property: "og:description", content: "Every ERAD primitive and state in light and dark." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DesignPage,
});

function DesignPage() {
  return (
    <div className="grid grid-cols-1 2xl:grid-cols-2">
      <Board theme="light" />
      <Board theme="dark" />
    </div>
  );
}

const ROWS = [
  { id: "1", name: "Master Service Agreement – Nordlys Retail AB", type: "Contract", status: "Effective" },
  { id: "2", name: "Quote Q-2026-0412.pdf", type: "Quote", status: "In review" },
  { id: "3", name: "invoice_copy_final.pdf", type: "Order attachment", status: "Quarantined" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-label-14-medium text-text-secondary">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

function Board({ theme }: { theme: "light" | "dark" }) {
  const [dialog, setDialog] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState("docs");
  const [sel, setSel] = useState<Set<string>>(new Set(["2"]));
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  return (
    <div data-theme={theme} className="flex flex-col gap-6 bg-layer-content p-4">
      <h1 className="type-title-18-medium">{theme === "light" ? "Light" : "Dark"} theme</h1>

      <Section title="Buttons">
        <Button>Default</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="destructive"><Trash2 aria-hidden="true" />Delete</Button>
        <Button variant="ai-primary"><Sparkles aria-hidden="true" />Read with AI</Button>
        <Button variant="ai-default"><Sparkles aria-hidden="true" />Suggest</Button>
        <Button size="icon" aria-label="Download"><Download aria-hidden="true" /></Button>
        <div className="flex flex-col gap-1">
          <Button variant="primary" unavailable aria-describedby={`r-${theme}`}>Approve</Button>
          <span id={`r-${theme}`} className="type-label-12 text-text-secondary">2 required details need checking</span>
        </div>
      </Section>

      <Section title="Fields">
        <TextField label="Contract number" placeholder="MSA-SE-…" helper="As printed on page 1" />
        <TextField label="Counterparty" defaultValue="Fjärrvärme Syd AS" error="The page says “AB”, not “AS”." />
        <TextField label="Read only" defaultValue="Aurora Mobile Sweden" readOnly />
        <Select
          label="Type"
          placeholder="Choose a type"
          groups={[
            { label: "Commercial", options: [{ value: "quote", label: "Quote" }, { value: "contract", label: "Contract" }] },
            { label: "Other", options: [{ value: "tech", label: "Technical document" }, { value: "kyc", label: "KYC outcome", disabled: true }] },
          ]}
        />
      </Section>

      <Section title="Choices">
        <div className="flex flex-col gap-2">
          <Checkbox label="Unchecked" />
          <Checkbox label="Checked" defaultChecked />
          <Checkbox label="Indeterminate" checked="indeterminate" />
          <Checkbox label="Disabled" disabled />
        </div>
        <RadioGroup
          label="Signature"
          defaultValue="advanced"
          options={[
            { value: "simple", label: "Simple" },
            { value: "advanced", label: "Advanced" },
            { value: "qualified", label: "Qualified", disabled: true },
          ]}
        />
      </Section>

      <Section title="Tags and pills">
        <Tag tone="cleared">Ready</Tag>
        <Tag tone="warning">In review</Tag>
        <Tag tone="major">Expired</Tag>
        <Tag tone="minor">On hold</Tag>
        <Tag tone="critical">Quarantined</Tag>
        <Tag tone="indeterminate">Draft</Tag>
        <Tag tone="warning" small>2 to check</Tag>
        <Pill label="Type: Contract" onRemove={() => undefined} />
        <Pill label="Signed" selected={false} onToggle={() => undefined} />
        <Tooltip content="Delete unavailable: legal hold DSP-2026-031">
          <Button>Hover or focus me</Button>
        </Tooltip>
      </Section>

      <Section title="Table">
        <div className="w-full">
          <DataTable
            caption="Sample documents"
            columns={[
              { key: "name", header: "Name", sortable: true, cell: (r) => r.name },
              { key: "type", header: "Type", cell: (r) => r.type },
              { key: "status", header: "Status", cell: (r) => <Tag tone={r.status === "Quarantined" ? "critical" : r.status === "Effective" ? "cleared" : "warning"}>{r.status}</Tag> },
            ]}
            rows={ROWS}
            rowId={(r) => r.id}
            selected={sel}
            onToggleRow={(id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            sort={sort}
            onSort={(k) => setSort((s) => ({ key: k, dir: s.dir === "asc" ? "desc" : "asc" }))}
            rowActions={() => <Button size="icon" aria-label="Download"><Download aria-hidden="true" /></Button>}
            striped
          />
          <SkeletonRow columns={3} />
        </div>
      </Section>

      <Section title="Tabs and breadcrumb">
        <NavTabs label="Record" value={tab} onValueChange={setTab} items={[
          { value: "docs", caption: "Documents", icon: FileText },
          { value: "act", caption: "Activity", icon: History },
        ]} />
        <div className="w-full">
          <TextTabs label="Record sections" defaultValue="d" tabs={[
            { value: "o", label: "Overview", content: <p className="type-paragraph-14">Overview</p> },
            { value: "d", label: "Documents 10 · 2 need attention", content: <p className="type-paragraph-14">Documents</p> },
          ]} />
        </div>
        <Breadcrumb items={[{ label: "Accounts" }, { label: "Nordlys Retail AB" }, { label: "Documents" }]} />
      </Section>

      <Section title="Card, banner, panel">
        <Card title="Key facts" actions={<Button>Open</Button>}>Signed (qualified) · Ends 29 Feb 2028 · Renews automatically</Card>
        <div className="w-full">
          <Banner tone="minor" status="On hold">Delete unavailable: legal hold DSP-2026-031.</Banner>
        </div>
        <div className="relative flex h-48 w-full border border-border-subtle">
          <div className="flex-1 p-4 type-paragraph-14">Content</div>
          <SidePanel title="Preview" collapsed={collapsed} onCollapsedChange={setCollapsed}>
            <p className="type-paragraph-14">Panel content</p>
          </SidePanel>
        </div>
      </Section>

      <Section title="Feedback">
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Button onClick={() => toast("Version 4 added")}>Show toast</Button>
        <Spinner />
        <Skeleton className="w-40" />
        <div className="w-40"><ProgressBar value={60} label="Uploading" /></div>
        <Avatar name="Elin Bergqvist" />
        <Divider />
        <EmptyState icon={Inbox} title="No documents yet" cause="Documents added to this record will show here." action={<Button variant="primary">Add documents</Button>} />
      </Section>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Delete document?"
        description="You can restore it from Deleted for 30 days."
        actions={<><Button onClick={() => setDialog(false)}>Keep</Button><Button variant="destructive" onClick={() => setDialog(false)}>Delete</Button></>}
      />
    </div>
  );
}
