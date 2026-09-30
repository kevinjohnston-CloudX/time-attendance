"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { Button, Checkbox } from "@/components/ui";

interface Column {
  id: string;
  label: string;
  type: string;
}

/**
 * Which columns the report carries, as checkboxes two across in the
 * builder's side rail, and the order they run in, as a list under them.
 *
 * <p>The report lists its columns in the order picked here (prod's column
 * strip, drawn as the pay codes list is). A column joins the end of the list
 * when it is ticked. Rows drag like pay codes do, and each also has move up
 * and move down, since a drag needs a steady hand and a keyboard cannot do one.
 */
export function ColumnPicker({
  columns,
  selected,
  onChange,
}: {
  columns: Column[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const allSelected = selected.length === columns.length;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const ordered = selected.filter((id) => byId.has(id));

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= ordered.length) return;
    const next = [...ordered];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    onChange(next);
  }

  function endDrag() {
    setDragId(null);
    setOverId(null);
  }

  function drop(targetId: string) {
    if (dragId && dragId !== targetId) move(ordered.indexOf(dragId), ordered.indexOf(targetId));
    endDrag();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]">
        {columns.map((col) => (
          <div key={col.id} className="flex min-w-0 items-center py-1">
            <Checkbox checked={selected.includes(col.id)} onChange={() => toggle(col.id)} label={col.label} />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* The count is what says a report with no columns cannot run,
            before the Save button refuses without a reason. */}
        <span
          className="tabular"
          style={{
            font: "var(--type-body2)",
            color: selected.length === 0 ? "var(--text-error)" : "var(--text-tertiary)",
          }}
        >
          {selected.length === 0 ? "Pick at least one column" : `${selected.length} of ${columns.length} columns`}
        </span>
        <Button size="sm" hierarchy="link" onClick={() => onChange(allSelected ? [] : columns.map((c) => c.id))}>
          {allSelected ? "Clear all" : "Select all"}
        </Button>
      </div>

      {ordered.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="wms-label">Column order</span>
          <ol
            aria-label="Column order"
            className="m-0 flex list-none flex-col p-0"
            style={{ border: "1px solid var(--stroke-divider)", borderRadius: "var(--radius-m)", overflow: "hidden" }}
          >
            {ordered.map((id, i) => (
              <li
                key={id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (id !== dragId) setOverId(id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(id);
                }}
                onDragEnd={endDrag}
                className="flex h-8 min-w-0 items-center gap-2 pl-2 pr-1"
                style={{
                  borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)",
                  background: overId === id ? "var(--surface-info)" : "var(--surface-card)",
                  opacity: dragId === id ? 0.45 : 1,
                }}
              >
                <span className="flex flex-none cursor-grab items-center active:cursor-grabbing" title="Drag to move">
                  <GripVertical className="h-4 w-4" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
                </span>
                <span className="tabular w-4 flex-none text-right" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
                  {byId.get(id)!.label}
                </span>
                <Button
                  size="sm"
                  hierarchy="tertiary"
                  iconOnly
                  aria-label={`Move ${byId.get(id)!.label} up`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  hierarchy="tertiary"
                  iconOnly
                  aria-label={`Move ${byId.get(id)!.label} down`}
                  disabled={i === ordered.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
