"use client";

import { useEffect, useState } from "react";

type Option = { id: string; name: string };

/**
 * A filter that takes several values, picked the way NovaTime does it: a
 * window with Available and Selected lists and buttons to move items between
 * them. An empty Selected list means all.
 */
export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [pickLeft, setPickLeft] = useState<string[]>([]);
  const [pickRight, setPickRight] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const names = options.filter((o) => value.includes(o.id)).map((o) => o.name);
  const summary = names.length === 0 ? "All" : names.length <= 2 ? names.join(", ") : `${names.length} selected`;

  const chosen = new Set(draft);
  const available = options.filter((o) => !chosen.has(o.id));
  const selected = options.filter((o) => chosen.has(o.id));

  function openDialog() {
    setDraft(value);
    setPickLeft([]);
    setPickRight([]);
    setOpen(true);
  }
  const add = (ids: string[]) => { setDraft((d) => [...new Set([...d, ...ids])]); setPickLeft([]); };
  const remove = (ids: string[]) => { setDraft((d) => d.filter((x) => !ids.includes(x))); setPickRight([]); };
  const picked = (e: React.ChangeEvent<HTMLSelectElement>) => [...e.target.selectedOptions].map((o) => o.value);

  const listCls = "h-64 w-full rounded-lg border border-zinc-300 bg-white p-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
  const moveCls = "rounded border border-zinc-300 px-2.5 py-1 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</label>
      <button
        type="button"
        onClick={openDialog}
        title={names.length > 2 ? names.join(", ") : undefined}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 ${names.length ? "text-zinc-900 dark:text-white" : "text-zinc-500"}`}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="text-zinc-400">…</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-label={`${label} filter`} className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{label} Filter</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
            </div>
            <div className="px-6 py-5">
              <p className="mb-4 text-xs text-zinc-500">
                Use the buttons in the middle to move items between the lists. To include everyone, leave Selected empty.
                Ctrl or Shift click to highlight several; double-click an item to move it.
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Available ({available.length})</p>
                  <select
                    multiple
                    autoFocus
                    value={pickLeft}
                    onChange={(e) => setPickLeft(picked(e))}
                    onDoubleClick={(e) => { const v = (e.target as HTMLOptionElement).value; if (v) add([v]); }}
                    className={listCls}
                    aria-label={`Available ${label}`}
                  >
                    {available.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-2 pt-6">
                  <button type="button" className={moveCls} title="Add highlighted" aria-label="Add the highlighted items" disabled={!pickLeft.length} onClick={() => add(pickLeft)}>›</button>
                  <button type="button" className={moveCls} title="Add all" aria-label="Add all" disabled={!available.length} onClick={() => add(available.map((o) => o.id))}>»</button>
                  <button type="button" className={moveCls} title="Remove highlighted" aria-label="Remove the highlighted items" disabled={!pickRight.length} onClick={() => remove(pickRight)}>‹</button>
                  <button type="button" className={moveCls} title="Remove all" aria-label="Remove all" disabled={!selected.length} onClick={() => remove(selected.map((o) => o.id))}>«</button>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Selected ({selected.length})</p>
                  <select
                    multiple
                    value={pickRight}
                    onChange={(e) => setPickRight(picked(e))}
                    onDoubleClick={(e) => { const v = (e.target as HTMLOptionElement).value; if (v) remove([v]); }}
                    className={listCls}
                    aria-label={`Selected ${label}`}
                  >
                    {selected.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300">
                Cancel
              </button>
              <button type="button" onClick={() => { onChange(draft); setOpen(false); }} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
