"use client";

import { useRef } from "react";
import { GripVertical } from "lucide-react";

interface Column {
  id: string;
  label: string;
  type: string;
  defaultVisible?: boolean;
}

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
  const dragIndex = useRef<number | null>(null);

  function toggleAll() {
    if (allSelected) onChange([]);
    else onChange(columns.map((c) => c.id));
  }

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(index: number, e: React.DragEvent) {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = [...selected];
    const [item] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, item);
    dragIndex.current = index;
    onChange(next);
  }

  function handleDragEnd() {
    dragIndex.current = null;
  }

  return (
    <div>
      {/* Checkbox grid — unchanged */}
      <div className="mb-3 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="rounded border-zinc-300 dark:border-zinc-600"
          />
          Select all
        </label>
        <span className="text-xs text-zinc-400">
          {selected.length} of {columns.length} selected
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {columns.map((col) => (
          <label
            key={col.id}
            className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
          >
            <input
              type="checkbox"
              checked={selected.includes(col.id)}
              onChange={() => toggle(col.id)}
              className="rounded border-zinc-300 dark:border-zinc-600"
            />
            <span className="text-zinc-800 dark:text-zinc-200">{col.label}</span>
            <span className="text-[10px] text-zinc-400">{col.type}</span>
          </label>
        ))}
      </div>

      {/* Drag-to-reorder strip */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Column order — drag to rearrange
        </p>
        <div
          className="flex min-h-[120px] flex-wrap content-start gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
          onDragOver={(e) => e.preventDefault()}
        >
          {selected.length === 0 ? (
            <span className="m-auto text-sm text-zinc-400">
              Select columns above to set their order
            </span>
          ) : (
            selected.map((id, index) => {
              const col = columns.find((c) => c.id === id);
              if (!col) return null;
              return (
                <div
                  key={id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(index, e)}
                  onDragEnd={handleDragEnd}
                  className="flex cursor-grab items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm select-none active:cursor-grabbing dark:border-zinc-600 dark:bg-zinc-800"
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <span className="text-zinc-800 dark:text-zinc-200">{col.label}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
