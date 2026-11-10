import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, LogOut, Moon, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { Tag } from "@/components/erad/tag";
import { Avatar } from "@/components/erad/misc";
import { useTheme } from "@/hooks/use-theme";

const NAV = [
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/admin", label: "Admin", icon: Settings },
] as const;

export interface AppShellProps {
  tenantName: string;
  userName: string;
  children: ReactNode;
}

export function AppShell({ tenantName, userName, children }: AppShellProps) {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: undefined }, replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-layer-content">
      <header className="bg-layer-system text-text-on-primary">
        <div className="mx-auto flex h-12 max-w-[1920px] items-center gap-3 px-4">
          <span className="type-title-16-medium">Documents</span>
          <span className="rounded-badge border border-status-purple px-2 type-label-12 leading-6">
            Prototype · synthetic data only
          </span>
          <span className="ml-auto type-label-14">{tenantName}</span>
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            className="focus-ring flex size-8 items-center justify-center rounded-control hover:bg-btn-default-hover"
          >
            {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              aria-label={`Account menu for ${userName}`}
              className="focus-ring flex items-center gap-2 rounded-control px-1 py-1 hover:bg-btn-default-hover"
            >
              <Avatar name={userName} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="shadow-elev-1 z-50 min-w-48 bg-item text-text-main">
                <div className="type-label-12 px-2 py-2 text-text-secondary">{userName}</div>
                <DropdownMenu.Separator className="h-px bg-border-subtle" />
                <DropdownMenu.Item
                  onSelect={signOut}
                  className="type-label-14 flex h-8 cursor-pointer items-center gap-2 px-2 outline-none data-[highlighted]:bg-item-hover"
                >
                  <LogOut className="size-4" aria-hidden="true" /> Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1920px] flex-1">
        {/* 240px navigation; collapses to 80px below 1280px (reflow for zoom, WCAG 1.4.10). */}
        <nav aria-label="Main" className="w-20 shrink-0 bg-layer-application py-2 xl:w-60">
          <ul className="flex flex-col">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  aria-label={label}
                  className="focus-ring type-label-14 flex h-10 items-center justify-center gap-2 px-4 text-text-main hover:bg-item-hover xl:justify-start"
                  activeProps={{ className: "bg-item-selected text-text-on-primary hover:bg-item-selected-hover", "aria-current": "page" }}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="hidden xl:inline">{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="relative min-w-0 flex-1 px-4 py-4">{children}</main>
      </div>
      <span className="sr-only">
        <Tag tone="purple">Prototype</Tag>
      </span>
    </div>
  );
}
