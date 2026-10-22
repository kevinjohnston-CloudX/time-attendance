"use client";

import { CalendarDays, FileSignature, IdCard, LayoutList, Rows3, Tags, type LucideIcon } from "lucide-react";
import type { AcrossSpec } from "@/lib/reports/across";
import type { PrintLayout } from "@/lib/reports/grouping";
import { DEFAULT_STATEMENT } from "./print-layout-config";

interface Column {
  id: string;
  label: string;
  type: string;
  across?: boolean;
}

/** What a preset sets: the groups, the print layout and the columns across. */
export interface LayoutState {
  groupBy: string[];
  layout: PrintLayout;
  across: AcrossSpec | undefined;
  /** Columns across combine rows by the text columns shown, so those presets set them too. */
  columns?: string[];
}

interface Preset {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  state: LayoutState;
}

/**
 * How a report looks, as a few named choices HR recognises: a plain list,
 * totals by site and department, a page per employee to sign, days or pay
 * codes as columns, a card per person. Each sets the detailed options
 * (groups, print, columns across), which stay below to fine tune. Only the
 * choices the report type can do are offered.
 */
export function presetsFor(columns: Column[], groupable: string[]): Preset[] {
  const has = (id: string) => columns.some((c) => c.id === id);
  const can = (id: string) => groupable.includes(id);
  const across = (id: string) => columns.some((c) => c.id === id && c.across);
  // The hours worth spreading: paid hours, else the total, else any hours.
  const hours =
    ["paidMinutes", "totalMinutes", "durationMinutes"].find(has) ??
    columns.find((c) => c.type === "number" && c.id.endsWith("Minutes"))?.id;
  // For columns across: who the row is, the week when there is one, then the
  // hours spread and the regular and overtime beside them.
  const acrossColumns = (keys: string[]) =>
    [...keys.filter(has), hours!, ...["regMinutes", "otMinutes", "regularMinutes", "overtimeMinutes"].filter((id) => has(id) && id !== hours)];
  const out: Preset[] = [
    { id: "list", icon: LayoutList, title: "A list", body: "One row after another, no totals.", state: { groupBy: [], layout: {}, across: undefined } },
  ];
  const sums = ["site", "department"].filter(can);
  if (sums.length) {
    out.push({
      id: "totals",
      icon: Rows3,
      title: sums.length === 2 ? "Totals by site and department" : "Totals by department",
      body: "Rows in groups, with a total under each and a grand total.",
      state: { groupBy: sums, layout: {}, across: undefined },
    });
  }
  if (can("employeeName")) {
    out.push({
      id: "signed",
      icon: FileSignature,
      title: "A page per employee, to sign",
      body: "Each person on their own printed page, with their total and signature lines.",
      state: {
        groupBy: ["employeeName"],
        layout: { pageBreak: "employeeName", signature: { text: DEFAULT_STATEMENT, employee: true, supervisor: true } },
        across: undefined,
      },
    });
  }
  if (across("weekday") && hours) {
    out.push({
      id: "days",
      icon: CalendarDays,
      title: "Days of the week as columns",
      body: "A row per person and week, Sunday to Saturday side by side, with a total.",
      state: { groupBy: sums, layout: {}, across: { field: "weekday", value: hours }, columns: acrossColumns(["employeeName", "employeeCode", "week"]) },
    });
  }
  const code = ["payCodeHours", "payCodeLabel"].find(across);
  if (code && hours) {
    out.push({
      id: "codes",
      icon: Tags,
      title: "Pay codes as columns",
      body: "A row per person, a column for each pay code, with a total.",
      state: { groupBy: sums.slice(-1), layout: {}, across: { field: code, value: hours }, columns: acrossColumns(["employeeName", "employeeCode"]) },
    });
  }
  out.push({
    id: "cards",
    icon: IdCard,
    title: "One card per row",
    body: "Each row's columns listed one under another, like a profile.",
    state: { groupBy: can("employeeName") ? ["employeeName"] : [], layout: { cards: true, ...(can("employeeName") ? { pageBreak: "employeeName" } : {}) }, across: undefined },
  });
  return out;
}

/** Which preset the settings now match, if any. */
function matching(presets: Preset[], now: LayoutState): string | null {
  const key = (s: LayoutState) =>
    JSON.stringify([s.groupBy, s.layout.pageBreak ?? null, !!s.layout.signature, !!s.layout.cards, s.across?.field ?? null]);
  return presets.find((p) => key(p.state) === key(now))?.id ?? null;
}

export function LayoutPresets({
  columns,
  groupable,
  value,
  onChange,
}: {
  columns: Column[];
  groupable: string[];
  value: LayoutState;
  onChange: (next: LayoutState) => void;
}) {
  const presets = presetsFor(columns, groupable);
  const on = matching(presets, value);
  return (
    <div role="radiogroup" aria-label="How it looks" className="flex flex-col gap-1">
      {presets.map((p) => {
        const chosen = p.id === on;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            onClick={() => onChange(p.state)}
            className={`flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left ${chosen ? "" : "ta-hoverable"}`}
            style={{
              border: 0,
              cursor: "pointer",
              background: chosen ? "var(--ta-choice-on)" : "transparent",
              boxShadow: chosen ? "inset 0 0 0 1px var(--stroke-accent)" : undefined,
            }}
          >
            <span
              className="grid h-8 w-8 flex-none place-items-center rounded-lg"
              style={{
                background: chosen ? "var(--surface-card)" : "var(--ta-well)",
                boxShadow: chosen ? "var(--ta-raised)" : "inset 0 0 0 1px var(--ta-well-ring)",
                color: chosen ? "var(--icon-accent)" : "var(--icon-tertiary)",
              }}
              aria-hidden="true"
            >
              <p.icon className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: chosen ? "var(--text-accent)" : "var(--text-primary)" }}>
                {p.title}
              </span>
              <span style={{ font: "var(--type-caption1)", color: "var(--text-secondary)" }}>{p.body}</span>
            </span>
          </button>
        );
      })}
      {!on && (
        <span className="px-2 pt-1" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
          Set your own way in More layout options.
        </span>
      )}
    </div>
  );
}
