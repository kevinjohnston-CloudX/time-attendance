"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useEffect, useTransition, useSyncExternalStore } from "react";
import { signOut } from "next-auth/react";
import { LogOut, PanelLeftClose, PanelLeft, Eye, X, Search } from "lucide-react";
import { setViewAsRole, clearViewAsRole } from "@/actions/view-as.actions";
import { BrandIcon, BrandMark } from "./brand-mark";
import { openCommandPalette } from "./command-palette";
import {
  SECTIONS,
  ROLE_LABEL,
  INACTIVE_ALLOWED_HREFS,
  activeHref,
} from "./nav-model";

const COLLAPSE_KEY = "ta.sidebar.collapsed";

/**
 * Whether the sidebar is collapsed, kept in localStorage so the choice
 * survives a reload — the design system says the toggle persists.
 *
 * <p>Read through useSyncExternalStore rather than copied into state on
 * mount. The server cannot know what this browser stored, so the first render
 * has to say "expanded" and the truth has to arrive afterwards; doing that by
 * hand means a setState inside an effect, which React now flags as a
 * cascading render. useSyncExternalStore is the supported way to say exactly
 * this: here is the server's answer, here is the browser's, re-render when it
 * changes.
 *
 * <p>The "storage" event covers the same account open in a second tab.
 */
const collapseStore = {
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) {
    collapseStore.listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      collapseStore.listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
  get(): boolean {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false; // private window, blocked storage — expanded is the safe default
    }
  },
  /** What the server renders. It has no browser to ask. */
  getServer(): boolean {
    return false;
  },
  set(next: boolean) {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* not worth failing the click over */
    }
    collapseStore.listeners.forEach((l) => l());
  },
};

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  return (
    <span
      className="inline-flex flex-none items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: "var(--wms-color-primary-100)",
        color: "var(--wms-color-primary-700)",
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        fontSize: Math.round(size * 0.4),
        lineHeight: 1,
      }}
      title={name ?? undefined}
    >
      {initials(name)}
    </span>
  );
}

interface SidebarProps {
  role: string;
  userName?: string | null;
  permissions?: string[];
  realRole?: string;
  viewAsRole?: string | null;
  canViewAs?: boolean;
  viewAsOptions?: { id: string; name: string }[];
  isInactive?: boolean;
}

export function Sidebar({
  userName,
  permissions,
  realRole,
  viewAsRole,
  canViewAs = false,
  viewAsOptions = [],
  isInactive = false,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const collapsed = useSyncExternalStore(
    collapseStore.subscribe,
    collapseStore.get,
    collapseStore.getServer,
  );
  const [showRolePicker, setShowRolePicker] = useState(false);
  const rolePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rolePickerRef.current && !rolePickerRef.current.contains(e.target as Node)) {
        setShowRolePicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSetViewAs(customRoleId: string) {
    startTransition(async () => {
      await setViewAsRole(customRoleId);
      setShowRolePicker(false);
      router.push("/dashboard");
      router.refresh();
    });
  }

  function handleClearViewAs() {
    startTransition(async () => {
      await clearViewAsRole();
      setShowRolePicker(false);
      router.push("/dashboard");
      router.refresh();
    });
  }

  function hasPermission(perm?: string | string[]) {
    if (!perm) return true;
    if (!permissions || permissions.length === 0) return false;
    if (Array.isArray(perm)) return perm.some((p) => permissions.includes(p));
    return permissions.includes(perm);
  }

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: isInactive
      ? section.items.filter((i) => INACTIVE_ALLOWED_HREFS.includes(i.href))
      : section.items.filter((i) => hasPermission(i.permission)),
  })).filter((section) => section.items.length > 0);

  const current = activeHref(
    pathname,
    sections.flatMap((s) => s.items.map((i) => i.href)),
  );

  return (
    <aside
      className="flex h-full flex-none flex-col transition-[width] duration-200 ease-in-out"
      style={{
        width: collapsed ? 64 : 232,
        background: "var(--surface-card)",
        borderRight: "1px solid var(--stroke-secondary)",
      }}
    >
      {/* 56px, the same as the top bar, so the two line up across the seam. */}
      <div
        className="flex h-14 flex-none items-center gap-2.5 px-3.5"
        style={{ borderBottom: "1px solid var(--stroke-divider)" }}
      >
        {collapsed ? <BrandIcon /> : <BrandMark />}
      </div>

      {/* The design's search field. It opens the ⌘K palette rather than
          being a second search box with its own behaviour. */}
      {!collapsed && (
        <div className="flex-none px-3 pb-1.5 pt-2.5">
          <button
            onClick={openCommandPalette}
            className="ta-field flex h-[30px] w-full items-center gap-2 rounded-md px-2"
            style={{
              border: "1px solid var(--stroke-secondary)",
              background: "var(--surface-tertiary)",
              color: "var(--text-tertiary)",
              font: "var(--type-body2)",
            }}
          >
            <Search className="h-[15px] w-[15px] flex-none" />
            <span className="flex-1 text-left">Search</span>
            <kbd
              className="rounded px-1"
              style={{
                font: "var(--type-caption1)",
                border: "1px solid var(--stroke-secondary)",
                background: "var(--surface-card)",
              }}
            >
              ⌘K
            </kbd>
          </button>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-2 pb-3 pt-1">
        {sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-0.5">
            {collapsed ? (
              <div className="mx-2 my-1 h-px" style={{ background: "var(--stroke-divider)" }} />
            ) : (
              <div
                className="px-2 py-1 uppercase"
                style={{
                  font: "var(--type-overline)",
                  letterSpacing: "0.05em",
                  color: "var(--text-tertiary)",
                }}
              >
                {section.label}
              </div>
            )}

            {section.items.map((item) => {
              const isActive = current === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  data-active={isActive}
                  className={`ta-hoverable flex h-8 items-center rounded-md ${
                    collapsed ? "justify-center px-0" : "gap-2.5 px-2"
                  }`}
                  style={{
                    font: "var(--type-button1)",
                    background: isActive ? "var(--wms-color-primary-50)" : "transparent",
                    color: isActive ? "var(--text-accent)" : "var(--text-secondary)",
                  }}
                >
                  <item.icon
                    className="h-[18px] w-[18px] shrink-0"
                    style={{ color: isActive ? "var(--icon-accent)" : "var(--icon-secondary)" }}
                  />
                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span
                          className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1.5"
                          style={{
                            font: "var(--type-caption2)",
                            background: "var(--wms-color-primary-600)",
                            color: "var(--text-on-accent)",
                          }}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {isInactive && !collapsed && (
        <div
          className="mx-2 mb-2 rounded-md px-3 py-2"
          style={{
            font: "var(--type-caption1)",
            background: "var(--surface-warning)",
            color: "var(--text-warning)",
            border: "1px solid var(--stroke-warning)",
          }}
        >
          Account inactive — view only
        </div>
      )}

      <div className="flex-none px-3 py-2.5" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        {viewAsRole && !collapsed && (
          <div
            className="mb-2 flex items-center justify-between rounded-md px-2 py-1.5"
            style={{ background: "var(--surface-warning)" }}
          >
            <span className="flex items-center gap-1.5">
              <Eye className="h-3 w-3" style={{ color: "var(--icon-warning)" }} />
              <span style={{ font: "var(--type-caption1)", color: "var(--text-warning)" }}>
                {viewAsRole}
              </span>
            </span>
            <button
              onClick={handleClearViewAs}
              disabled={isPending}
              title="Return to your role"
              className="rounded p-0.5 disabled:opacity-50"
              style={{ color: "var(--icon-warning)" }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div ref={rolePickerRef} className="relative flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => canViewAs && setShowRolePicker((v) => !v)}
            className={`ta-hoverable flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 ${
              canViewAs ? "cursor-pointer" : "cursor-default"
            }`}
            title={collapsed ? (userName ?? undefined) : undefined}
          >
            <Avatar name={userName} />
            {!collapsed && (
              <span className="min-w-0 flex-1 text-left">
                <span
                  className="block truncate"
                  style={{ font: "var(--type-body2)", fontWeight: "var(--weight-medium)" }}
                >
                  {userName ?? "—"}
                </span>
                <span
                  className="block truncate"
                  style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}
                >
                  {ROLE_LABEL[realRole ?? ""] ?? realRole}
                </span>
              </span>
            )}
            {!collapsed && canViewAs && !viewAsRole && (
              <Eye className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--icon-secondary)" }} />
            )}
          </button>

          {!collapsed && (
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              title="Sign out"
              className="ta-hoverable inline-flex flex-none rounded-md p-1.5"
              style={{ color: "var(--icon-secondary)" }}
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}

          {showRolePicker && (
            <div
              className="absolute bottom-full left-0 mb-1 w-full overflow-hidden rounded-lg py-1.5"
              style={{
                background: "var(--surface-card)",
                border: "1px solid var(--stroke-secondary)",
                boxShadow: "var(--shadow-menu)",
              }}
            >
              <p
                className="px-3 pb-1 pt-0.5 uppercase"
                style={{ font: "var(--type-overline)", color: "var(--text-tertiary)" }}
              >
                View as
              </p>
              {viewAsOptions.length === 0 && (
                <p className="px-3 py-2" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  No roles available
                </p>
              )}
              {viewAsOptions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={isPending || r.name === viewAsRole}
                  onClick={() => handleSetViewAs(r.id)}
                  className="ta-hoverable flex w-full items-center px-3 py-1.5 disabled:opacity-40"
                  style={{
                    font: "var(--type-body2)",
                    background: r.name === viewAsRole ? "var(--surface-info)" : "transparent",
                    color: r.name === viewAsRole ? "var(--text-accent)" : "var(--text-secondary)",
                  }}
                >
                  {r.name}
                  {r.name === viewAsRole && (
                    <span className="ml-auto" style={{ font: "var(--type-caption1)" }}>
                      active
                    </span>
                  )}
                </button>
              ))}
              {viewAsRole && (
                <>
                  <div className="my-1 h-px" style={{ background: "var(--stroke-divider)" }} />
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleClearViewAs}
                    className="ta-hoverable flex w-full items-center gap-2 px-3 py-1.5 disabled:opacity-40"
                    style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                  >
                    <X className="h-3.5 w-3.5" />
                    Return to {ROLE_LABEL[realRole ?? ""] ?? realRole}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => collapseStore.set(!collapsed)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`ta-hoverable mt-1 flex h-8 w-full items-center rounded-md ${
            collapsed ? "justify-center px-0" : "gap-2.5 px-2"
          }`}
          style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>

        {collapsed && (
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign out"
            className="ta-hoverable mt-1 flex h-8 w-full items-center justify-center rounded-md"
            style={{ color: "var(--icon-secondary)" }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
