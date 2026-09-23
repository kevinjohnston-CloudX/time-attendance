"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ChevronRight } from "lucide-react";
import { locate } from "./nav-model";
import { ThemeToggle } from "./theme-toggle";
import { KeyboardShortcuts } from "./keyboard-shortcuts";

/**
 * The 56px bar above the content, from the portal design.
 *
 * <p>It exists for the breadcrumb. The admin area is three levels deep in
 * places — a site inside Sites inside Administration — and until now the only
 * thing telling you where you were was which sidebar row happened to be
 * highlighted. The trail is built from the same nav model the sidebar renders,
 * so the two cannot disagree about which section a page belongs to.
 *
 * <p>The design also puts a notifications bell and an avatar menu up here.
 * Neither has anything behind it yet, and chrome that does nothing when
 * clicked is worse than chrome that is absent, so this carries the
 * breadcrumb, the theme switch and the shortcuts list only. The command
 * palette the design draws here is reached from the sidebar search and ⌘K.
 */
export function TopBar({ reachableHrefs }: { reachableHrefs: string[] }) {
  const pathname = usePathname();
  const here = locate(pathname);

  return (
    <header
      className="flex h-14 flex-none items-center gap-3 px-4"
      style={{
        background: "var(--surface-card)",
        borderBottom: "1px solid var(--stroke-secondary)",
      }}
    >
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
        <ThemeToggle />
        <KeyboardShortcuts reachableHrefs={reachableHrefs} />
      </div>
    </header>
  );
}
