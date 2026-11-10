import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/erad/app-shell";
import { Spinner } from "@/components/erad/misc";
import { meQuery, useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    return { user: data.user };
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(meQuery),
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Loading your workspace" />
    </div>
  ),
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const me = useMe();
  if (!me.access) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-layer-content px-4">
        <p className="type-paragraph-14" role="status">No access assigned. Ask an administrator.</p>
      </main>
    );
  }
  return (
    <AppShell tenantName={me.access.tenantName} userName={me.access.displayName}>
      <Outlet />
    </AppShell>
  );
}
