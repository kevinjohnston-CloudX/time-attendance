"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
 * The bar above the content, from the Layout handoff: 36px with no rule under
 * it, sitting on the canvas. A glass pill on the left holds the sidebar toggle
 * and the breadcrumb; on the right the Nav switch, then one pill holding the
 * theme, the shortcuts and the bell.
 *
 * <p>It exists for the breadcrumb. The admin area is three levels deep in
 * places, a site inside Sites inside Administration, and the trail is built
 * from the same nav model the sidebar renders, so the two cannot disagree
 * about which section a page belongs to. Every step before the page you are on
 * is a link back, and a record page ends the trail on the record's own name,
 * both beyond what the handoff draws.
 *
 * <p>The avatar menu some designs put up here is absent on purpose: the
 * sidebar's user card already carries the name, the role and sign out, and two
 * places to sign out is worse than one.
 */
export function TopBar({
  reachableHrefs,
  waiting,
  classicOffered = false,
  classicUntil = null,
  signInId,
}: {
  reachableHrefs: string[];
  waiting: WaitingItem[];
  /** Whether this person can pick Classic; false draws no design switch. */
  classicOffered?: boolean;
  /** The classic design's last day, as words; null for no end date. */
  classicUntil?: string | null;
  signInId?: string;
}) {
  const pathname = usePathname();
  const navMode = useNavMode();
  const collapsed = useSidebarCollapsed();
  const here = locate(pathname);
  const leaf = useBreadcrumbLeafFor(pathname);
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    // z-30: above the pages' pinned headers (z-20), so the bell's list and
    // the design switch's note open over them rather than behind.
    <header className="relative z-30 flex h-9 flex-none items-center gap-2 px-3 lg:gap-2.5">
      <nav
        aria-label="Breadcrumb"
        // Under 1024px the pill keeps only the sidebar toggle: the trail has
        // no room there, and the page's own title sits right under it. The
        // rail has no toggle, so there the pill goes until the window widens.
        className={`${navMode === "rail" ? "hidden lg:flex" : "flex"} h-8 min-w-0 items-center gap-0.5 overflow-hidden rounded-full pl-[3px] pr-[3px] uppercase lg:pr-2.5`}
        style={{
          // Never narrower than the sidebar toggle and home, which stay whole
          // while the trail truncates.
          minWidth: navMode === "grouped" ? 32 : undefined,
          background: "var(--ta-glass)",
          boxShadow: "inset 0 0 0 1px var(--ta-ring-strong)",
          font: "var(--weight-semibold) 11px/1 var(--font-sans)",
          letterSpacing: "0.06em",
          color: "var(--text-tertiary)",
        }}
      >
        {/* The grouped sidebar's collapse toggle, first in the pill beside the
            column it resizes. The rail has no collapsed state, so no toggle. */}
        {navMode === "grouped" && (
          <>
            <button
              type="button"
              onClick={() => collapseStore.set(!collapsed)}
              title={`${toggleLabel}  [`}
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              className="ta-pill-btn grid h-[26px] w-[26px] flex-none place-items-center rounded-full"
              style={{ color: "var(--icon-secondary)" }}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <span
              aria-hidden
              className="ml-0.5 mr-1 hidden h-3.5 w-px flex-none lg:block"
              style={{ background: "var(--stroke-secondary)" }}
            />
          </>
        )}

        <Link
          href="/dashboard"
          title="Dashboard"
          className="ta-pill-btn hidden h-6 w-6 flex-none place-items-center rounded-full lg:grid"
          style={{ color: "var(--icon-secondary)" }}
        >
          <Home className="h-3.5 w-3.5" />
        </Link>

        {here && (
          <span className="hidden min-w-0 items-center gap-0.5 lg:flex">
            <Chevron />
            <Crumb
              label={here.section.label}
              href={here.section.href}
              current={!here.item && !leaf && pathname === here.section.href}
              last={!here.item && !leaf}
            />
            {here.item && (
              <>
                <Chevron />
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
                <Chevron />
                <Crumb label={leaf} current last />
              </>
            )}
          </span>
        )}
      </nav>

      <div className="flex-1" />

      {classicOffered && (
        <Suspense fallback={null}>
          <DesignSwitch classicUntil={classicUntil} signInId={signInId} />
        </Suspense>
      )}

      {/* The navigation layout switch: a label and a small segmented control.
          Under 1024px the label goes and the switch stays, so the bell never
          gets pushed off the edge. */}
      <span
        className="hidden flex-none whitespace-nowrap uppercase lg:inline"
        style={{
          font: "var(--weight-semibold) 10px/1 var(--font-sans)",
          letterSpacing: "0.08em",
          color: "var(--text-tertiary)",
        }}
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

      <div
        className="relative flex h-[34px] flex-none items-center gap-0.5 rounded-full px-[3px]"
        style={{ background: "var(--surface-card)", boxShadow: "var(--ta-pill-shadow)" }}
      >
        <ThemeToggle />
        <KeyboardShortcuts reachableHrefs={reachableHrefs} />
        <NotificationBell items={waiting} />
      </div>
    </header>
  );
}

function Chevron({ className = "" }: { className?: string }) {
  return <ChevronRight className={`h-3 w-3 flex-none ${className}`} style={{ color: "var(--icon-disabled)" }} />;
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
  // Every step can shrink, the page you are on last of all, so a narrow
  // window truncates the trail inside its pill instead of spilling over.
  const cls = `min-w-0 truncate whitespace-nowrap px-1${last ? " shrink-[0.2]" : ""}`;
  if (href && !current) {
    return (
      <Link
        href={href}
        className={`ta-crumb ${cls} rounded-full`}
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
