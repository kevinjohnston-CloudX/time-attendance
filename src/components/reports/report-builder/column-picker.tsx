"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import { Button, Select } from "@/components/ui";
import phone from "../reports-phone.module.css";

interface Column {
  id: string;
  label: string;
  type: string;
}

/**
 * The columns the report shows, as one list in the order they run, and a
 * choice to add any other.
 *
 * <p>It was two lists: every column as a checkbox, then the ticked ones again
 * under "Column order", which read twice and pushed the rest of the settings
 * down. Rows drag; each also moves up and down, since a drag needs a steady
 * hand and a keyboard cannot do one, and comes off with its cross.
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const ordered = selected.filter((id) => byId.has(id));
  const others = columns.filter((c) => !ordered.includes(c.id));

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
    <div className="flex flex-col gap-2.5">
      {ordered.length === 0 ? (
        <p className="m-0" style={{ font: "var(--type-body2)", color: "var(--text-error)" }}>
          Add at least one column to see rows.
        </p>
      ) : (
        <ol
          aria-label="Columns shown, in order"
          className="m-0 flex list-none flex-col p-0"
          style={{ border: "1px solid var(--stroke-divider)", borderRadius: "var(--radius-m)", overflow: "hidden" }}
        >
          {ordered.map((id, i) => {
            const label = byId.get(id)!.label;
            return (
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
                className="flex h-9 min-w-0 items-center gap-2 pl-2 pr-1"
                style={{
                  borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)",
                  background: overId === id ? "var(--surface-info)" : "var(--surface-card)",
                  opacity: dragId === id ? 0.45 : 1,
                }}
              >
                <span className={`${phone.grip} flex flex-none cursor-grab items-center active:cursor-grabbing`} title="Drag to move">
                  <GripVertical className="h-4 w-4" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
                  {label}
                </span>
                <Button size="sm" hierarchy="tertiary" iconOnly aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  hierarchy="tertiary"
                  iconOnly
                  aria-label={`Move ${label} down`}
                  disabled={i === ordered.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  hierarchy="tertiary"
                  iconOnly
                  aria-label={`Remove ${label}`}
                  title={`Remove ${label}`}
                  onClick={() => onChange(ordered.filter((x) => x !== id))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ol>
      )}

      {others.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            value=""
            onChange={(e) => e.target.value && onChange([...ordered, e.target.value])}
            aria-label="Add a column"
            style={{ flex: 1, minWidth: 0 }}
          >
            <option value="">Add a column</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <Button size="sm" hierarchy="link" onClick={() => onChange([...ordered, ...others.map((c) => c.id)])}>
            Add all {others.length}
          </Button>
        </div>
      )}
    </div>
  );
}
