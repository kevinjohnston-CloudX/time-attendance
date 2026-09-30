"use client";

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

  return (
    <div>
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
            <span className="text-zinc-800 dark:text-zinc-200">
              {col.label}
            </span>
            <span className="text-[10px] text-zinc-400">{col.type}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
