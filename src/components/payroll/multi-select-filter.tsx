"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ListFilter } from "lucide-react";
import { Button } from "@/components/ui";
import { PpDialog } from "@/components/payroll/pp-dialog";

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

  const listStyle: React.CSSProperties = {
    width: "100%",
    height: 260,
    border: "1px solid var(--stroke-default)",
    borderRadius: 8,
    background: "var(--surface-card)",
    color: "var(--text-primary)",
    font: "var(--type-body2)",
    padding: 4,
  };
  const heading = (text: string, n: number) => (
    <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>
      {text} <span style={{ color: "var(--text-tertiary)" }}>({n})</span>
    </span>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>{label}</span>
      <button
        type="button"
        onClick={openDialog}
        title={names.length > 2 ? names.join(", ") : undefined}
        className="ta-field flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left"
        style={{
          border: "1px solid var(--stroke-default)",
          background: "var(--surface-card)",
          color: names.length ? "var(--text-primary)" : "var(--text-secondary)",
          font: "var(--type-body1)",
        }}
      >
        <span className="truncate">{summary}</span>
        <ListFilter className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
      </button>

      {open && (
        <PpDialog
          icon={<ListFilter className="h-[18px] w-[18px]" aria-hidden />}
          title={`${label} filter`}
          subtitle="Move items to Selected to filter by them. Leave Selected empty to include all."
          width={680}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button hierarchy="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => { onChange(draft); setOpen(false); }}>OK</Button>
            </>
          }
        >
          <div className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)" }}>
            <label className="flex min-w-0 flex-col gap-1.5">
              {heading("Available", available.length)}
              <select
                multiple
                value={pickLeft}
                onChange={(e) => setPickLeft(picked(e))}
                onDoubleClick={(e) => { const v = (e.target as HTMLOptionElement).value; if (v) add([v]); }}
                style={listStyle}
                aria-label={`Available ${label}`}
              >
                {available.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>

            <div className="flex flex-col gap-2 pt-6">
              <Button size="sm" hierarchy="secondary" iconOnly aria-label="Add the highlighted items" title="Add highlighted" disabled={!pickLeft.length} onClick={() => add(pickLeft)} leadingIcon={<ChevronRight className="h-4 w-4" />} />
              <Button size="sm" hierarchy="secondary" iconOnly aria-label="Add all" title="Add all" disabled={!available.length} onClick={() => add(available.map((o) => o.id))} leadingIcon={<ChevronsRight className="h-4 w-4" />} />
              <Button size="sm" hierarchy="secondary" iconOnly aria-label="Remove the highlighted items" title="Remove highlighted" disabled={!pickRight.length} onClick={() => remove(pickRight)} leadingIcon={<ChevronLeft className="h-4 w-4" />} />
              <Button size="sm" hierarchy="secondary" iconOnly aria-label="Remove all" title="Remove all" disabled={!selected.length} onClick={() => remove(selected.map((o) => o.id))} leadingIcon={<ChevronsLeft className="h-4 w-4" />} />
            </div>

            <label className="flex min-w-0 flex-col gap-1.5">
              {heading("Selected", selected.length)}
              <select
                multiple
                value={pickRight}
                onChange={(e) => setPickRight(picked(e))}
                onDoubleClick={(e) => { const v = (e.target as HTMLOptionElement).value; if (v) remove([v]); }}
                style={listStyle}
                aria-label={`Selected ${label}`}
              >
                {selected.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          </div>
          <p className="m-0 mt-2" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            Ctrl or Shift click to highlight several. Double-click an item to move it.
          </p>
        </PpDialog>
      )}
    </div>
  );
}
