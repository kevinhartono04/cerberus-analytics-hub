"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardCheck,
  Gauge,
  LogIn,
  LogOut,
  Moon,
  Shield,
  Sun,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import React, { CSSProperties, ReactNode, useEffect, useState } from "react";

export type HubProductId = "spec-generator" | "tech-launch" | "spec-check";

type ProductItem = {
  id: HubProductId;
  label: string;
  href: string;
  icon: LucideIcon;
  accent: string;
};

const products: ProductItem[] = [
  { id: "spec-generator", label: "Event Design", href: "/", icon: Wand2, accent: "#3d82ff" },
  { id: "tech-launch", label: "Launch Readiness", href: "/tech-launch", icon: Gauge, accent: "#4edea3" },
  { id: "spec-check", label: "Analytics QA", href: "/spec-check", icon: ClipboardCheck, accent: "#48d9ff" },
];

export type ShellNavItem<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
};

type ShellUser = {
  authenticated: boolean;
  name?: string | null;
  email?: string | null;
  roleLabel?: string;
  accountType?: "internal" | "external";
};

type ShellMeResponse = {
  authenticated: boolean;
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
  } | null;
  access: {
    accountType: "internal" | "external";
    techLaunchApps: string[];
  } | null;
};

function formatRoleLabel(role?: string) {
  return role ? `${role.slice(0, 1).toUpperCase()}${role.slice(1)}` : undefined;
}

function ProductLink({ product, active, collapsed }: { product: ProductItem; active: boolean; collapsed: boolean }) {
  const Icon = product.icon;

  return (
    <a
      href={product.href}
      title={collapsed ? product.label : undefined}
      aria-current={active ? "page" : undefined}
      className={`product-link focus-ring flex h-10 w-full items-center gap-3 rounded-[10px] border-l-2 px-3 text-sm font-semibold transition-colors ${
        active ? "product-link-active" : ""
      } ${
        collapsed ? "justify-center" : "justify-start max-md:justify-center"
      }`}
      style={{ "--product-accent": product.accent } as CSSProperties}
    >
      <Icon className="product-link-icon h-[18px] w-[18px] shrink-0" />
      {collapsed ? null : <span className="truncate max-md:hidden">{product.label}</span>}
    </a>
  );
}

function UserPanel({ user, collapsed, isLoading = false }: { user?: ShellUser; collapsed: boolean; isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div
        aria-label="Loading account"
        className={`flex h-10 w-full items-center gap-3 rounded-md border border-line bg-surface-panel px-3 ${
          collapsed ? "justify-center" : "justify-start max-md:justify-center"
        }`}
      >
        <div className="h-5 w-5 shrink-0 animate-pulse rounded-md bg-sage" />
        {collapsed ? null : <div className="h-3 w-24 animate-pulse rounded bg-sage max-md:hidden" />}
      </div>
    );
  }

  if (!user?.authenticated) {
    return (
      <a
        href="/sign-in"
        title={collapsed ? "Sign in" : undefined}
        className={`focus-ring flex h-10 w-full items-center gap-2 rounded-md border border-line bg-surface-panel px-3 text-sm font-semibold text-cobalt hover:bg-sage ${
          collapsed ? "justify-center" : "justify-start max-md:justify-center"
        }`}
      >
        <LogIn className="h-4 w-4" />
        {collapsed ? null : <span className="max-md:hidden">Sign in</span>}
      </a>
    );
  }

  const displayName = user.name || user.email || "Tripledot Analyst";
  const initials = displayName
    .split(/[.\s@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className={collapsed ? "space-y-2 text-center" : "space-y-2"}>
      {collapsed ? (
        <div title={`${user.email ?? displayName} · ${user.roleLabel ?? "Editor"}`} className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-cobalt/15">
          <Shield className="h-4 w-4 text-cobalt" />
        </div>
      ) : (
        <div className="max-md:hidden">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cobalt text-sm font-bold text-white">{initials || "TR"}</div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-ink">{displayName}</div>
              <div className="truncate text-xs text-slate-500">{user.email}</div>
            </div>
          </div>
          <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-cobalt/30 bg-cobalt/10 px-2 py-1 text-[11px] font-bold uppercase text-cobalt">
            <Shield className="h-3 w-3" />
            {user.roleLabel ?? "Editor"}
          </div>
        </div>
      )}
      <a
        href="/api/auth/signout?callbackUrl=/sign-in"
        title={collapsed ? "Sign out" : undefined}
        className={`focus-ring flex h-9 w-full items-center gap-2 rounded-md border border-line bg-surface-panel px-3 text-xs font-semibold text-slate-500 hover:bg-sage hover:text-ink ${
          collapsed ? "justify-center" : "justify-start max-md:justify-center"
        }`}
      >
        <LogOut className="h-3.5 w-3.5" />
        {collapsed ? null : <span className="max-md:hidden">Sign out</span>}
      </a>
    </div>
  );
}

export default function CerberusShell<T extends string>({
  currentProduct,
  navItems = [],
  activeNav,
  onNavChange,
  collapsed = false,
  onToggleCollapsed,
  user,
  contentClassName = "max-w-[1320px]",
  activeLaunchSection = "technical",
  children,
}: {
  currentProduct: HubProductId;
  navItems?: ShellNavItem<T>[];
  activeNav?: T;
  onNavChange?: (value: T) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  user?: ShellUser;
  contentClassName?: string;
  activeLaunchSection?: "technical" | "level-funnel" | "game-monitoring";
  children: ReactNode;
}) {
  const hasExplicitUser = user !== undefined;
  const [sessionUser, setSessionUser] = useState<ShellUser | undefined>(user);
  const [launchReadinessExpanded, setLaunchReadinessExpanded] = useState(currentProduct === "tech-launch");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const savedTheme = document.documentElement.dataset.theme;
    setTheme(savedTheme === "light" ? "light" : "dark");
  }, []);

  useEffect(() => {
    if (hasExplicitUser) {
      setSessionUser(user);
      return;
    }

    let cancelled = false;

    void fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load account");
        return (await response.json()) as ShellMeResponse;
      })
      .then((response) => {
        if (cancelled) return;

        if (!response.authenticated || !response.user) {
          setSessionUser({ authenticated: false });
          return;
        }

        setSessionUser({
          authenticated: true,
          name: response.user.name,
          email: response.user.email,
          roleLabel: formatRoleLabel(response.user.role),
          accountType: response.access?.accountType,
        });
      })
      .catch(() => {
        if (!cancelled) setSessionUser({ authenticated: false });
      });

    return () => {
      cancelled = true;
    };
  }, [hasExplicitUser, user?.accountType, user?.authenticated, user?.email, user?.name, user?.roleLabel]);

  const sidebarUser = hasExplicitUser ? user : sessionUser;
  const isLoadingUser = !hasExplicitUser && sessionUser === undefined;
  const visibleProducts = sidebarUser?.accountType === "external" ? products.filter((product) => product.id === "tech-launch") : products;
  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);

    try {
      localStorage.setItem("cerberus-theme", nextTheme);
    } catch {
      // The UI should still switch when browser storage is unavailable.
    }
  };

  return (
    <main className="min-h-screen bg-mist">
      <div className="shell-backdrop flex min-h-screen">
        <aside
          className={`shell-sidebar sticky top-0 flex h-screen shrink-0 flex-col border-r border-line/70 transition-[width] duration-200 ${
            collapsed ? "w-20" : "w-20 md:w-[264px]"
          }`}
        >
          <div className={`border-b border-line/50 px-4 py-5 ${collapsed ? "text-center" : ""}`}>
            <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : "max-md:justify-center"}`}>
              <div className="brand-tile relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-cobalt/30 shadow-[0_0_18px_rgba(61,130,255,0.12)]">
                <img src="/cerberus_logo_512.png" alt="Cerberus" className="relative h-10 w-10 object-contain" />
              </div>
              {collapsed ? null : (
                <div className="min-w-0 max-md:hidden">
                  <h1 className="font-brand text-[18px] font-bold leading-none text-ink">Cerberus</h1>
                  <div className="mt-2 flex items-center gap-1.5 leading-none text-brand-muted">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cobalt shadow-[0_0_8px_#3d82ff]" />
                    <span className="font-brand text-[12px] font-semibold">Analytics Hub</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-6 px-3 py-4" aria-label="Analytics Hub">
            <div>
              {collapsed ? null : (
                <div className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500 max-md:hidden">
                  Products
                </div>
              )}
              <div className="flex flex-col gap-1">
                {visibleProducts.map((product) => {
                  const isLaunchReadiness = product.id === "tech-launch";
                  return (
                    <div key={product.id}>
                      <div className="flex items-center gap-1">
                        <ProductLink product={product} active={product.id === currentProduct} collapsed={collapsed} />
                        {isLaunchReadiness && !collapsed ? (
                          <button
                            type="button"
                            aria-label={launchReadinessExpanded ? "Collapse Launch Readiness sections" : "Expand Launch Readiness sections"}
                            aria-expanded={launchReadinessExpanded}
                            onClick={() => setLaunchReadinessExpanded((expanded) => !expanded)}
                            className="focus-ring -ml-9 mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-sage hover:text-slate-200 max-md:hidden"
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${launchReadinessExpanded ? "" : "-rotate-90"}`} />
                          </button>
                        ) : null}
                      </div>
                      {isLaunchReadiness && !collapsed && launchReadinessExpanded ? (
                        <div className="ml-8 mt-1 flex flex-col gap-1 border-l border-line/70 pl-3 max-md:hidden">
                          <a href="/tech-launch" aria-current={activeLaunchSection === "technical" ? "page" : undefined} className={`focus-ring rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${activeLaunchSection === "technical" ? "bg-cobalt/10 text-cobalt" : "text-slate-500 hover:bg-sage hover:text-slate-200"}`}>Technical Readiness</a>
                          <a href="/tech-launch/level-funnel" aria-current={activeLaunchSection === "level-funnel" ? "page" : undefined} className={`focus-ring rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${activeLaunchSection === "level-funnel" ? "bg-cobalt/10 text-cobalt" : "text-slate-500 hover:bg-sage hover:text-slate-200"}`}>Level Funnel Check</a>
                          <a href="/tech-launch/game-monitoring" aria-current={activeLaunchSection === "game-monitoring" ? "page" : undefined} className={`focus-ring rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${activeLaunchSection === "game-monitoring" ? "bg-cobalt/10 text-cobalt" : "text-slate-500 hover:bg-sage hover:text-slate-200"}`}>Game Monitoring</a>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {navItems.length ? (
              <div>
                {collapsed ? null : (
                  <div className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500 max-md:hidden">
                    Workflow
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const active = item.id === activeNav;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        title={collapsed ? item.label : undefined}
                        aria-current={active ? "page" : undefined}
                        onClick={() => onNavChange?.(item.id)}
                        className={`focus-ring flex h-9 w-full items-center gap-3 rounded-[9px] border-l-2 px-3 text-sm font-medium transition-colors ${
                          collapsed ? "justify-center" : "justify-start max-md:justify-center"
                        } ${
                          active
                            ? "border-cobalt bg-cobalt/15 text-ink"
                            : "border-transparent bg-transparent text-slate-500 hover:bg-sage hover:text-ink"
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-cobalt" : "text-slate-500"}`} />
                        {collapsed ? null : <span className="truncate max-md:hidden">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </nav>

          <div className="border-t border-line/50 p-3">
            <UserPanel user={sidebarUser} collapsed={collapsed} isLoading={isLoadingUser} />
          </div>

          <div className="space-y-2 border-t border-line/50 p-3">
            <button
              type="button"
              role="switch"
              aria-checked={theme === "light"}
              title={collapsed ? "Light mode" : undefined}
              aria-label="Light mode"
              onClick={toggleTheme}
              className={`focus-ring flex h-10 w-full items-center gap-2 rounded-md border border-line bg-surface-panel px-3 text-sm font-semibold text-text-subtle hover:bg-sage hover:text-ink ${
                collapsed ? "justify-center" : "justify-start max-md:justify-center"
              }`}
            >
              {theme === "light" ? <Sun className="h-4 w-4 text-cobalt" /> : <Moon className="h-4 w-4" />}
              {collapsed ? null : <span className="max-md:hidden">Light mode</span>}
              {collapsed ? null : (
                <span
                  aria-hidden="true"
                  className={`ml-auto flex h-5 w-9 items-center rounded-full border p-0.5 transition-colors ${
                    theme === "light" ? "border-cobalt/50 bg-cobalt/15" : "border-line bg-surface-raised"
                  }`}
                >
                  <span className={`h-3.5 w-3.5 rounded-full bg-current transition-transform ${theme === "light" ? "translate-x-4 text-cobalt" : "translate-x-0 text-text-subtle"}`} />
                </span>
              )}
            </button>
            {onToggleCollapsed ? (
              <button
                type="button"
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={onToggleCollapsed}
                className={`focus-ring flex h-10 w-full items-center gap-2 rounded-md border border-line bg-surface-panel px-3 text-sm font-semibold text-slate-500 hover:bg-sage hover:text-ink ${
                  collapsed ? "justify-center" : "justify-start max-md:justify-center"
                }`}
              >
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                {collapsed ? null : <span className="max-md:hidden">Collapse</span>}
              </button>
            ) : null}
          </div>
        </aside>

        <section className="max-h-screen min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className={`mx-auto w-full px-4 py-8 md:px-9 ${contentClassName}`}>{children}</div>
        </section>
      </div>
    </main>
  );
}
