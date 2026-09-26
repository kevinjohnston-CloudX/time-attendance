"use client";

import { Check } from "lucide-react";
import { REPORT_GROUPS, dataSourceDescription } from "../data-source-label";
import { ReportTypeIcon } from "../report-type-icon";
import type { DataSourceId } from "@/lib/validators/report.schema";

interface DataSourceMeta {
  id: DataSourceId;
  label: string;
  description: string;
  icon: string;
  columns?: { id: string; label: string; defaultVisible?: boolean }[];
}

/**
 * The first decision in the builder: which report it is.
 *
 * <p>Tiles rather than a dropdown, because the choice fixes every field,
 * filter and grouping that follows and cannot be changed later without
 * throwing all three away. Each tile says what the report answers and which
 * columns it starts with, read from the report's own definition, which is
 * what stops somebody picking Punch audit when they wanted Hours summary.
 *
 * <p>The tiles sit in two groups, hours and attendance, then time off, the
 * two questions people come to this page with. A report type not in either
 * group is still offered, after them.
 */
export function DataSourcePicker({
  sources,
  selected,
  onSelect,
}: {
  sources: DataSourceMeta[];
  selected: DataSourceId | null;
  onSelect: (id: DataSourceId) => void;
}) {
  const byId = new Map(sources.map((s) => [s.id as string, s]));
  const grouped = new Set(REPORT_GROUPS.flatMap((g) => g.ids));
  const groups = [
    ...REPORT_GROUPS.map((g) => ({ title: g.title, items: g.ids.map((id) => byId.get(id)).filter((s): s is DataSourceMeta => !!s) })),
    { title: "Other", items: sources.filter((s) => !grouped.has(s.id)) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-2.5" role="group" aria-label={g.title}>
          <span className="wms-overline">{g.title}</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.items.map((ds) => (
              <Tile key={ds.id} ds={ds} selected={selected === ds.id} onSelect={() => onSelect(ds.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Tile({ ds, selected, onSelect }: { ds: DataSourceMeta; selected: boolean; onSelect: () => void }) {
  const starts = (ds.columns ?? []).filter((c) => c.defaultVisible).map((c) => c.label);
  const includes =
    starts.length > 4 ? `${starts.slice(0, 4).join(", ")} and ${starts.length - 4} more` : starts.join(", ");
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="ta-hub-card flex items-start gap-3.5 rounded-xl p-4 text-left"
      style={{
        border: `1px solid ${selected ? "var(--stroke-accent)" : "var(--stroke-secondary)"}`,
        boxShadow: selected ? "0 0 0 1px var(--stroke-accent)" : undefined,
        background: selected ? "var(--surface-info)" : "var(--surface-card)",
        cursor: "pointer",
      }}
    >
      <ReportTypeIcon id={ds.id} size={40} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1"
            style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)", color: selected ? "var(--text-accent)" : "var(--text-primary)" }}
          >
            {ds.label}
          </span>
          {/* A tick as well as the fill: colour alone does not say which
              one is picked to everyone. */}
          {selected && <Check className="h-4 w-4 flex-none" style={{ color: "var(--icon-accent)" }} aria-hidden="true" />}
        </span>
        <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
          {dataSourceDescription(ds.id) || ds.description}
        </span>
        {includes && (
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
            Includes {includes}
          </span>
        )}
      </span>
    </button>
  );
}
