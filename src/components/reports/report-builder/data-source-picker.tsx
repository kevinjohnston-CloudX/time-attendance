"use client";

import { Check } from "lucide-react";
import { dataSourceIcon } from "../data-source-label";
import type { DataSourceId } from "@/lib/validators/report.schema";

interface DataSourceMeta {
  id: DataSourceId;
  label: string;
  description: string;
  icon: string;
}

/**
 * The first decision in the builder: which table the report reads.
 *
 * <p>Tiles rather than a dropdown, because the choice fixes every field,
 * filter and grouping that follows and cannot be changed later without
 * throwing all three away — the description on each tile is what stops
 * somebody picking Punch Audit when they wanted Hours Summary.
 *
 * <p>The glyph comes from the shared source map rather than the `icon` string
 * on the definition: that string is a Lucide name chosen server-side, and the
 * map is what the list and the viewer already draw the same source with.
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
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(220px,30%)),1fr))]">
      {sources.map((ds) => {
        const Icon = dataSourceIcon(ds.id);
        const isSelected = selected === ds.id;
        return (
          <button
            key={ds.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(ds.id)}
            className="ta-hub-card flex flex-col gap-1.5 rounded-lg p-3.5 text-left"
            style={{
              border: `1px solid ${isSelected ? "var(--stroke-accent)" : "var(--stroke-secondary)"}`,
              background: isSelected ? "var(--surface-info)" : "var(--surface-card)",
              cursor: "pointer",
            }}
          >
            <span className="flex items-center gap-2">
              <Icon
                className="h-[18px] w-[18px] flex-none"
                style={{ color: isSelected ? "var(--icon-accent)" : "var(--icon-tertiary)" }}
                aria-hidden="true"
              />
              <span
                className="min-w-0 flex-1"
                style={{
                  font: "var(--type-body1)",
                  fontWeight: "var(--weight-semibold)",
                  color: isSelected ? "var(--text-accent)" : "var(--text-primary)",
                }}
              >
                {ds.label}
              </span>
              {/* A tick as well as the fill: the selected tile is the only
                  thing on this tab carrying state, and colour alone does not
                  say so to everyone. */}
              {isSelected && (
                <Check className="h-4 w-4 flex-none" style={{ color: "var(--icon-accent)" }} />
              )}
            </span>
            <span
              style={{
                font: "var(--type-body2)",
                color: "var(--text-secondary)",
                textWrap: "pretty",
              }}
            >
              {ds.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
