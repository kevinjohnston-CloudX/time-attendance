"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, LayoutGrid } from "lucide-react";
import { Button, EmptyState, SearchInput, Toolbar } from "@/components/ui";

/**
 * The Administration hub, from the portal design.
 *
 * <p>The design groups settings into five areas with a one-line explanation
 * each, puts the areas in a card of their own at the top with a count on every
 * one, and lists each group's pages as rows rather than tiles. That is a change
 * from the flat grid of ten identical cards, and it earns its keep here for a
 * reason the design could not have known: half the old grid was lying.
 *
 * <p>Five of the ten cards — Sites, Departments, Leave Types, PTO Policies and
 * Rule Sets — pointed at routes that are one-line redirect stubs, all of which
 * land on the same Company Setup page, four of them without even selecting the
 * right tab. Clicking two different cards took you to the same screen. Every
 * destination here is the real page with the correct tab.
 *
 * <p>Rows rather than tiles because the label is what people scan for. Tiles
 * put the detail line under a 260px-wide label and wrapped most of them onto
 * three lines, so nineteen settings ran to two screens of scrolling.
 *
 * <p>Filtering is client-side over a list the server already narrowed by
 * permission, so nothing here can reveal a page the viewer could not open. It
 * stays in React state rather than the query string, unlike the list screens:
 * this narrows a fixed menu the server sent in full, so there is no second
 * query behind it and nothing about a chosen area is worth sending to someone
 * else.
 */

export type HubItem = {
  label: string;
  detail: string;
  href: string;
  /** Lucide icon supplied by the server component, already resolved. */
  icon: React.ReactNode;
};

export type HubGroup = {
  label: string;
  hint: string;
  icon: React.ReactNode;
  items: HubItem[];
};

export function AdminHub({ groups }: { groups: HubGroup[] }) {
  const [query, setQuery] = useState("");
  /** null is "all areas" — a sentinel string could collide with a group label. */
  const [area, setArea] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => area === null || g.label === area)
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => !q || `${i.label} ${i.detail} ${g.label}`.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query, area]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const shown = filtered.reduce((n, g) => n + g.items.length, 0);

  const areas: { key: string | null; label: string; count: number; icon: React.ReactNode }[] = [
    { key: null, label: "All settings", count: total, icon: <LayoutGrid className="h-[18px] w-[18px]" /> },
    ...groups.map((g) => ({ key: g.label, label: g.label, count: g.items.length, icon: g.icon })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="ta-card flex flex-col gap-2.5 rounded-xl p-4">
        <span className="wms-overline">Settings areas</span>
        <div className="grid gap-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
          {areas.map((a) => {
            const active = a.key === area;
            return (
              <button
                key={a.key ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setArea(a.key)}
                className="ta-hoverable flex items-center gap-2.5 rounded-lg px-3 py-2 text-left"
                data-active={active ? "true" : undefined}
                style={{
                  border: "none",
                  cursor: "pointer",
                  background: active ? "var(--wms-color-primary-50)" : "transparent",
                  color: active ? "var(--text-accent)" : "var(--text-primary)",
                  font: "var(--type-body1)",
                  fontWeight: active ? "var(--weight-semibold)" : "var(--weight-medium)",
                }}
              >
                <span className="inline-flex flex-none" style={{ color: active ? "var(--icon-accent)" : "var(--icon-tertiary)" }}>
                  {a.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                <span
                  className="tabular flex-none"
                  style={{
                    font: "var(--type-body2)",
                    color: active ? "var(--text-accent)" : "var(--text-tertiary)",
                  }}
                >
                  {a.count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
        Press ⌘K to jump straight to any setting.
      </p>

      {/* The count is the whole point of this row. "Nothing here" and "nothing
          matching that word" look identical without it, and the area card above
          still shows what the unfiltered totals are. */}
      <Toolbar count={shown} countLabel="settings page">
        <SearchInput value={query} onValueChange={setQuery} placeholder="Filter settings" width={320} />
      </Toolbar>

      {shown === 0 ? (
        <div className="ta-card rounded-xl">
          <EmptyState
            title="Nothing matches that search"
            body="Try a shorter word, like “pay” or “leave”."
            action={
              <Button
                hierarchy="secondary"
                onClick={() => {
                  setQuery("");
                  setArea(null);
                }}
              >
                Show all settings
              </Button>
            }
          />
        </div>
      ) : (
        filtered.map((group) => (
          <section key={group.label} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
                {group.label}
              </h2>
              <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                {group.items.length} {group.items.length === 1 ? "page" : "pages"}
              </span>
              <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                {group.hint}
              </span>
            </div>

            {/* Hairlines between rows are a 1px gap over the divider colour
                rather than a border on each row: a border would double up
                against the panel's own edge at the top and bottom of the
                group. The design system draws its row groups the same way. */}
            <div
              className="flex flex-col overflow-hidden rounded-xl"
              style={{
                gap: 1,
                background: "var(--stroke-divider)",
                border: "1px solid var(--stroke-secondary)",
              }}
            >
              {group.items.map((item) => (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className="ta-hoverable grid items-center gap-x-3.5 gap-y-2 px-4 py-3 [grid-template-columns:32px_minmax(0,1fr)_18px]"
                  style={{ background: "var(--surface-card)", color: "var(--text-primary)", textDecoration: "none" }}
                >
                  <span
                    className="inline-flex items-center justify-center self-start"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      background: "var(--wms-color-primary-50)",
                      color: "var(--icon-accent)",
                    }}
                  >
                    {item.icon}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)" }}>
                      {item.label}
                    </span>
                    <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                      {item.detail}
                    </span>
                  </span>
                  <ChevronRight className="h-[17px] w-[17px] flex-none" style={{ color: "var(--icon-tertiary)" }} />
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
