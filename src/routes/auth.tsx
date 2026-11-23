import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/erad/button";
import { TextField } from "@/components/erad/text-field";
import { Tag } from "@/components/erad/tag";
import { loginErrorText, safePath } from "@/lib/safe-path";

const search = z.object({
  redirect: z.string().optional(),
  // Set when someone logs out on purpose, so the page confirms it (EDS sign in pattern).
  loggedOut: z.literal(1).optional().catch(undefined),
});
/** Legal warning shown before any access (Ericsson security requirement, configurable per customer). */
export const LEGAL_WARNING =
  "Access is only allowed for authorized users. If you are not an authorized user, exit now. Personal information is kept in log files for legal, security and cost reasons.";

export const Route = createFileRoute("/auth")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Log in · Documents" },
      {
        name: "description",
        content: "Log in to Documents, the telecom document workspace prototype.",
      },
      { property: "og:title", content: "Log in · Documents" },
      {
        property: "og:description",
        content: "Log in to Documents, the telecom document workspace prototype.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { redirect, loggedOut } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError(loginErrorText(err.status));
      return;
    }
    navigate({ to: safePath(redirect, window.location.origin), replace: true });
  }

  return (
    // EDS: the log in page is always dark, whatever theme the person chose inside the app.
    <div data-theme="dark" className="flex min-h-screen flex-col bg-layer-system text-text-main">
      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <form
          onSubmit={onSubmit}
          className="flex w-[400px] max-w-full flex-col gap-4 bg-layer-content p-8"
          aria-labelledby="auth-title"
        >
          <div className="flex flex-col gap-2">
            <h1 id="auth-title" className="type-title-18-medium">
              Documents
            </h1>
            <Tag tone="purple" className="self-start">
              Prototype · synthetic data only
            </Tag>
          </div>
          <p role="status" className="type-paragraph-14 empty:hidden">
            {loggedOut ? "You have logged out. Log in again to continue." : ""}
          </p>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            // First stop on a page that is only this form (EDS sign in pattern).
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" variant="primary" unavailable={busy} className="self-stretch">
            {busy ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </main>
      <footer className="type-label-12 mx-auto max-w-[720px] px-4 pb-6 text-center text-text-secondary">
        {LEGAL_WARNING}
      </footer>
    </div>
  );
}
