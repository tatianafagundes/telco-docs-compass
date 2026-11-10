import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/erad/button";
import { TextField } from "@/components/erad/text-field";
import { Tag } from "@/components/erad/tag";

const search = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Sign in · Documents" },
      { name: "description", content: "Sign in to Documents, the telecom document workspace prototype." },
      { property: "og:title", content: "Sign in · Documents" },
      { property: "og:description", content: "Sign in to Documents, the telecom document workspace prototype." },
    ],
  }),
  component: AuthPage,
});

function safePath(p: string | undefined) {
  if (!p) return "/documents";
  try {
    const u = new URL(p, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search : "/documents";
  } catch {
    return "/documents";
  }
}

function AuthPage() {
  const { redirect } = Route.useSearch();
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
      setError("That email and password did not match. You can try again.");
      return;
    }
    navigate({ to: safePath(redirect), replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-layer-content px-4">
      <form
        onSubmit={onSubmit}
        className="flex w-[572px] max-w-full flex-col gap-4 border border-border-item bg-item p-6"
        aria-labelledby="auth-title"
      >
        <div className="flex flex-col gap-2">
          <h1 id="auth-title" className="type-title-18-medium">Documents</h1>
          <Tag tone="purple" icon={false} className="self-start">Prototype · synthetic data only</Tag>
        </div>
        <TextField label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" unavailable={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </main>
  );
}
