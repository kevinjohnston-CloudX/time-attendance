"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ChevronRight, PanelLeft } from "lucide-react";
import { locate } from "./nav-model";
import { ThemeToggle } from "./theme-toggle";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { NotificationBell } from "./notification-bell";
import { SegmentedControl } from "@/components/ui";
import { navModeStore, useNavMode, collapseStore, useSidebarCollapsed, type NavMode } from "./nav-mode";
import type { WaitingItem } from "@/lib/dashboard/dashboard-data";

/**
 * The 56px bar above the content, from the portal design.
 *
 * <p>It exists for the breadcrumb. The admin area is three levels deep in
 * places — a site inside Sites inside Administration — and until now the only
 * thing telling you where you were was which sidebar row happened to be
 * highlighted. The trail is built from the same nav model the sidebar renders,
 * so the two cannot disagree about which section a page belongs to.
 *
 * <p>The avatar menu the design puts up here is still absent: it would
 * duplicate the sidebar footer, which already carries the name, the role and
 * sign out, and two places to sign out is worse than one. The command palette
 * the design draws here is reached from the sidebar search and ⌘K instead.
 */
export function TopBar({
  reachableHrefs,
  waiting,
}: {
  reachableHrefs: string[];
  waiting: WaitingItem[];
}) {
  const pathname = usePathname();
  const navMode = useNavMode();
  const collapsed = useSidebarCollapsed();
  const here = locate(pathname);

  return (
    <header
      className="flex h-14 flex-none items-center gap-3 px-4"
      style={{
        background: "var(--surface-card)",
        borderBottom: "1px solid var(--stroke-secondary)",
      }}
    >
      {/* The grouped sidebar's collapse toggle. One button in one place for
          both states, first in the bar beside the column it resizes. It used
          to sit in the sidebar's own header, squeezed against the wordmark
          when open and moved under the logo when closed. The rail has no
          collapsed state, so it gets no toggle. */}
      {navMode === "grouped" && (
        <>
          <button
            type="button"
            onClick={() => collapseStore.set(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="ta-hoverable -ml-1 inline-flex h-7 w-7 flex-none items-center justify-center rounded-md"
            style={{ color: "var(--icon-secondary)" }}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <span aria-hidden className="h-4 w-px flex-none" style={{ background: "var(--stroke-divider)" }} />
        </>
      )}

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5"
        style={{ font: "var(--type-overline)", color: "var(--text-secondary)" }}
      >
        <Link
          href="/dashboard"
          className="ta-hoverable inline-flex rounded p-1"
          title="Dashboard"
          style={{ color: "var(--icon-secondary)" }}
        >
          <Home className="h-3.5 w-3.5" />
        </Link>

        {here && (
          <>
            <ChevronRight className="h-3.5 w-3.5 flex-none" style={{ color: "var(--icon-disabled)" }} />
            <span
              className="uppercase tracking-[0.04em]"
              style={here.item ? undefined : { color: "var(--text-primary)" }}
            >
              {here.section.label}
            </span>
            {/* No leaf on a record page — the section is as far as the nav
                model can honestly say. */}
            {here.item && (
              <>
                <ChevronRight className="h-3.5 w-3.5 flex-none" style={{ color: "var(--icon-disabled)" }} />
                <span className="truncate uppercase tracking-[0.04em]" style={{ color: "var(--text-primary)" }}>
                  {here.item.label}
                </span>
              </>
            )}
          </>
        )}
      </nav>

      <div className="flex-1" />

      <div className="flex flex-none items-center gap-2">
        {/* The navigation layout switch, where the design puts it: a label and
            a small segmented control immediately before the theme button. */}
        <span
          className="whitespace-nowrap uppercase"
          style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", letterSpacing: "0.05em" }}
        >
          Nav
        </span>
        <SegmentedControl
          size="sm"
          ariaLabel="Navigation layout"
          value={navMode}
          onChange={(next) => navModeStore.set(next as NavMode)}
          items={[
            { value: "grouped", label: "Grouped" },
            { value: "rail", label: "Rail" },
          ]}
        />
        <ThemeToggle />
        <KeyboardShortcuts reachableHrefs={reachableHrefs} />
        <NotificationBell items={waiting} />
      </div>
    </header>
  );
}
