import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { adminAreas, homeFor, navCurrent, type AdminArea } from "@/lib/nav-section";
import { useNavMode } from "@/hooks/use-nav-mode";
import { Tooltip } from "@/components/erad/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  FileStack,
  FileText,
  Lock,
  LogOut,
  Menu,
  Moon,
  Plug,
  ScrollText,
  Settings,
  Share2,
  Sun,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { childTenantsQuery } from "@/hooks/use-config";
import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { Avatar } from "@/components/erad/misc";
import { useTheme } from "@/hooks/use-theme";
import { useDropGuard } from "@/hooks/use-drop-guard";

const ROLE_LABEL: Record<string, string> = {
  viewer: "Viewer",
  contributor: "Contributor",
  reviewer: "Reviewer",
  manager: "Manager",
  tenant_admin: "Administrator",
  master_admin: "Group administrator",
};

function navFor(role: string) {
  const admin = role === "tenant_admin" || role === "master_admin";
  return [
    // The group administrator sees counts and settings, never documents, so has no Documents page.
    ...(role === "master_admin" ? [] : [{ to: "/documents", label: "Documents", icon: FileText }]),
    { to: "/shared", label: "Shared with me", icon: Share2 },
    ...(role === "manager" ? [{ to: "/holds", label: "Holds and retention", icon: Lock }] : []),
    ...(admin ? [{ to: "/admin", label: "Admin", icon: Settings }] : []),
  ] as const;
}

export interface AppShellProps {
  tenantName: string;
  userName: string;
  role: string;
  children: ReactNode;
}

export function AppShell({ tenantName, userName, role, children }: AppShellProps) {
  const isMaster = role === "master_admin";
  const kids = useQuery({ ...childTenantsQuery, enabled: isMaster });
  const NAV = navFor(role);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggle } = useTheme();
  const nav = useNavMode();
  useDropGuard();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function logOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: undefined, loggedOut: 1 }, replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-layer-content">
      {/* First stop for the keyboard: jumps past the top bar and the navigation (WCAG 2.4.1). */}
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
        className="focus-ring type-label-14 sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:border focus:border-border-item focus:bg-item focus:px-3 focus:py-2 focus:text-text-main"
      >
        Skip to main content
      </a>
      <header className="bg-layer-system text-text-on-primary">
        <div className="mx-auto flex h-12 max-w-[1920px] items-center gap-3 px-4">
          <button
            type="button"
            onClick={nav.toggle}
            aria-expanded={nav.mode === "full"}
            aria-controls="main-nav"
            aria-label={nav.mode === "full" ? "Hide navigation labels" : "Show navigation labels"}
            className="focus-ring -ml-2 flex size-8 items-center justify-center rounded-control hover:bg-btn-default-hover"
          >
            <Menu aria-hidden="true" className="size-4" />
          </button>
          {/* EDS: the home link is always visible; the product name in the system bar is it. */}
          <Link to={homeFor(role)} className="focus-ring type-title-16-medium rounded-control">
            Documents
          </Link>
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
          {/* Not modal, like every menu here: the page behind is never hidden with aria-hidden. */}
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger
              aria-label={`Account menu for ${userName}`}
              className="focus-ring flex items-center gap-2 rounded-control px-1 py-1 hover:bg-btn-default-hover"
            >
              <Avatar name={userName} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="shadow-elev-1 z-50 min-w-48 bg-item text-text-main"
              >
                <div className="flex flex-col px-2 py-2">
                  <span className="type-label-14-medium">{userName}</span>
                  <span className="type-label-12 text-text-secondary">{`${tenantName} · ${ROLE_LABEL[role] ?? role}`}</span>
                </div>
                {isMaster ? (
                  <>
                    <DropdownMenu.Separator className="h-px bg-border-subtle" />
                    <DropdownMenu.Sub>
                      <DropdownMenu.SubTrigger className="type-label-14 flex h-8 cursor-pointer items-center gap-2 px-2 outline-none data-[highlighted]:bg-item-hover data-[state=open]:bg-item-hover">
                        <Building2 className="size-4" aria-hidden="true" /> Tenants
                      </DropdownMenu.SubTrigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.SubContent
                          sideOffset={4}
                          className="shadow-elev-1 z-50 min-w-48 bg-item text-text-main"
                        >
                          {(kids.data ?? []).map((k) => (
                            <DropdownMenu.Item
                              key={k.id}
                              onSelect={() =>
                                navigate({
                                  to: "/admin/tenants/$tenantId",
                                  params: { tenantId: k.id },
                                })
                              }
                              className="type-label-14 flex h-8 cursor-pointer items-center px-2 outline-none data-[highlighted]:bg-item-hover"
                            >
                              {k.displayName}
                            </DropdownMenu.Item>
                          ))}
                          {kids.data?.length === 0 ? (
                            <div className="type-label-14 px-2 py-2 text-text-secondary">
                              No organisations yet
                            </div>
                          ) : null}
                        </DropdownMenu.SubContent>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Sub>
                  </>
                ) : null}
                <DropdownMenu.Separator className="h-px bg-border-subtle" />
                <DropdownMenu.Item
                  onSelect={logOut}
                  className="type-label-14 flex h-8 cursor-pointer items-center gap-2 px-2 outline-none data-[highlighted]:bg-item-hover"
                >
                  <LogOut className="size-4" aria-hidden="true" /> Log out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1920px] flex-1">
        {/* 240px with labels or an 80px icon rail; the menu button switches (EDS local navigation). */}
        <nav
          id="main-nav"
          aria-label="Main"
          className={`${nav.mode === "full" ? "w-60" : "w-20"} shrink-0 bg-layer-application py-2`}
        >
          <ul className="flex flex-col">
            {NAV.map(({ to, label, icon }) =>
              to === "/admin" ? (
                <AdminNavItem
                  key={to}
                  role={role}
                  pathname={pathname}
                  icon={icon}
                  rail={nav.mode === "rail"}
                />
              ) : (
                <li key={to}>
                  <NavLink
                    to={to}
                    label={label}
                    icon={icon}
                    current={navCurrent(to, pathname)}
                    rail={nav.mode === "rail"}
                  />
                </li>
              ),
            )}
          </ul>
        </nav>
        <main
          id="main-content"
          tabIndex={-1}
          className="relative min-w-0 flex-1 px-4 py-4 outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

type NavIcon = typeof FileText;
const ITEM = "focus-ring type-label-14 flex h-10 min-w-0 flex-1 items-center gap-2 px-4";
/** In the icon rail the label moves to a tooltip; the accessible name stays the label. */
function WithTip({ rail, label, children }: { rail: boolean; label: string; children: ReactNode }) {
  return rail ? <Tooltip content={label}>{children}</Tooltip> : <>{children}</>;
}
function NavLink(p: {
  to: string;
  label: string;
  icon: NavIcon;
  current: "page" | "section" | null;
  child?: boolean;
  rail: boolean;
}) {
  const Icon = p.icon;
  return (
    <WithTip rail={p.rail} label={p.label}>
      <Link
        to={p.to}
        aria-label={p.label}
        // "page" for the page itself, "true" for a page inside the section (a record, a review).
        aria-current={p.current === "page" ? "page" : p.current ? "true" : undefined}
        activeOptions={{ exact: true }}
        className={`${ITEM} ${p.rail ? "justify-center" : ""} ${
          p.current
            ? "bg-item-selected text-text-on-primary hover:bg-item-selected-hover"
            : "text-text-main hover:bg-item-hover"
        }`}
      >
        <Icon
          className={p.child && !p.rail ? "ml-6 size-4 shrink-0" : "size-4 shrink-0"}
          aria-hidden="true"
        />
        {p.rail ? null : <span className="truncate">{p.label}</span>}
      </Link>
    </WithTip>
  );
}
const AREA_ICON: Record<AdminArea, NavIcon> = {
  "/admin/types": FileStack,
  "/admin/policies": ScrollText,
  "/admin/holds": Lock,
  "/admin/systems": Plug,
  "/admin/tenants": Building2,
};
/**
 * Admin as an EDS navigation tree: the label opens Admin, the chevron only shows or hides its
 * areas. Inside Admin the areas stay open and the current area, not Admin, is highlighted.
 */
function AdminNavItem({
  role,
  pathname,
  icon,
  rail,
}: {
  role: string;
  pathname: string;
  icon: NavIcon;
  rail: boolean;
}) {
  const areas = adminAreas(role);
  const inside = navCurrent("/admin", pathname) !== null;
  const [open, setOpen] = useState(inside);
  const shown = open || inside;
  const Icon = icon;
  return (
    <li>
      <div className="flex items-center">
        <WithTip rail={rail} label="Admin">
          <Link
            to="/admin"
            aria-label="Admin"
            // In a tree the current area is the current item, not its parent.
            activeOptions={{ exact: true }}
            className={`${ITEM} ${rail ? "justify-center" : ""} text-text-main hover:bg-item-hover ${inside ? "type-label-14-medium" : ""}`}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {rail ? null : <span>Admin</span>}
          </Link>
        </WithTip>
        {rail ? null : inside ? (
          // Inside Admin the areas stay open, so there is nothing to toggle: a plain mark, not a
          // button that cannot be pressed.
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center">
            <ChevronDown className="size-4 rotate-180" />
          </span>
        ) : (
          <button
            type="button"
            aria-expanded={shown}
            {...(shown ? { "aria-controls": "admin-areas" } : {})}
            aria-label={shown ? "Hide Admin areas" : "Show Admin areas"}
            onClick={() => setOpen((o) => !o)}
            className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center hover:bg-item-hover"
          >
            <ChevronDown
              aria-hidden="true"
              className={
                shown ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"
              }
            />
          </button>
        )}
      </div>
      {shown ? (
        <ul id="admin-areas" aria-label="Admin areas" className="flex flex-col">
          {areas.map((a) => (
            <li key={a.to} className="flex">
              <NavLink
                to={a.to}
                label={a.label}
                icon={AREA_ICON[a.to]}
                current={navCurrent(a.to, pathname)}
                child
                rail={rail}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
