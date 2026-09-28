"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ChevronRight, PanelLeft } from "lucide-react";
import { locate } from "./nav-model";
import { useBreadcrumbLeafFor } from "./breadcrumb-leaf";
import { ThemeToggle } from "./theme-toggle";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { NotificationBell } from "./notification-bell";
import { DesignSwitch } from "./design-switch";
import { SegmentedControl } from "@/components/ui";
import { navModeStore, useNavMode, collapseStore, useSidebarCollapsed, type NavMode } from "./nav-mode";
import type { WaitingItem } from "@/lib/dashboard/dashboard-data";

/**
 * The bar above the content, from the portal design, at 40px rather than the
 * design's 56px: it carries a breadcrumb and four small buttons, and every
 * pixel it takes is a pixel of list the page cannot show. The 28px controls
 * inside it keep their size.
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
  classicUrl = null,
}: {
  reachableHrefs: string[];
  waiting: WaitingItem[];
  /** The classic design's address; null draws no design switch. */
  classicUrl?: string | null;
}) {
  const pathname = usePathname();
  const navMode = useNavMode();
  const collapsed = useSidebarCollapsed();
  const here = locate(pathname);
  const leaf = useBreadcrumbLeafFor(pathname);

  return (
    <header
      className="flex h-10 flex-none items-center gap-3 px-4"
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
            <Crumb
              label={here.section.label}
              href={here.section.href}
              current={!here.item && !leaf && pathname === here.section.href}
              last={!here.item && !leaf}
            />
            {here.item && (
              <>
                <ChevronRight className="h-3.5 w-3.5 flex-none" style={{ color: "var(--icon-disabled)" }} />
                <Crumb
                  label={here.item.label}
                  href={here.item.href}
                  current={!leaf && pathname === here.item.href}
                  last={!leaf}
                />
              </>
            )}
            {/* A record page names itself, so the trail ends on the record
                rather than on the list it came from. */}
            {leaf && (
              <>
                <ChevronRight className="h-3.5 w-3.5 flex-none" style={{ color: "var(--icon-disabled)" }} />
                <Crumb label={leaf} current last />
              </>
            )}
          </>
        )}
      </nav>

      <div className="flex-1" />

      <div className="flex flex-none items-center gap-2">
        {classicUrl && (
          <Suspense fallback={null}>
            <DesignSwitch classicUrl={classicUrl} />
          </Suspense>
        )}
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

/**
 * One step of the trail. Every step before the page you are on is a link back
 * to it; the page you are on is plain text in the primary colour.
 */
function Crumb({
  label,
  href,
  current = false,
  last = false,
}: {
  label: string;
  href?: string;
  current?: boolean;
  last?: boolean;
}) {
  const cls = `uppercase tracking-[0.04em] whitespace-nowrap${last ? " min-w-0 truncate" : ""}`;
  if (href && !current) {
    return (
      <Link
        href={href}
        className={`ta-crumb ${cls} rounded px-1 -mx-1`}
        style={{ color: last ? "var(--text-primary)" : undefined }}
      >
        {label}
      </Link>
    );
  }
  return (
    <span
      className={cls}
      aria-current={current ? "page" : undefined}
      style={last ? { color: "var(--text-primary)" } : undefined}
    >
      {label}
    </span>
  );
}
