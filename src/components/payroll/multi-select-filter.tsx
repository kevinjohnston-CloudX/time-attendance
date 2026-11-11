"use client";

import { useState } from "react";
import { Check, ListFilter } from "lucide-react";
import { Button, SearchInput } from "@/components/ui";
import { Window, WindowCard } from "@/components/ui/window";
import styles from "./run-payroll.module.css";
import own from "./multi-select-filter.module.css";

type Option = { id: string; name: string };

/** More than this many and the window offers a search. */
const SEARCH_FROM = 8;

/**
 * A filter that takes several values: a window with one list, a tick on each
 * row, and Select all and Clear. Nothing ticked means all are included. The
 * choice is a draft until Apply filter, so Cancel leaves the filter as it was.
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
  const [q, setQ] = useState("");

  const names = options.filter((o) => value.includes(o.id)).map((o) => o.name);
  const summary = names.length === 0 ? "All" : names.length <= 2 ? names.join(", ") : `${names.length} selected`;

  const chosen = new Set(draft);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const shownIds = shown.map((o) => o.id);

  function openDialog() {
    setDraft(value);
    setQ("");
    setOpen(true);
  }
  const toggle = (id: string, on: boolean) => setDraft((d) => (on ? [...d, id] : d.filter((x) => x !== id)));
  const selectShown = () => setDraft((d) => [...new Set([...d, ...shownIds])]);
  const clearShown = () => setDraft((d) => d.filter((x) => !shownIds.includes(x)));

  const count =
    draft.length === 0
      ? `None ticked, so all ${options.length.toLocaleString("en-US")} are included`
      : `${draft.length.toLocaleString("en-US")} of ${options.length.toLocaleString("en-US")} selected`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>{label}</span>
      <button
        type="button"
        onClick={openDialog}
        title={names.length > 2 ? names.join(", ") : undefined}
        className={`${styles.filterButton} ta-field flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left`}
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
        <Window
          icon={<ListFilter />}
          title={label}
          subtitle="Tick the ones to include. With none ticked, all are included."
          size="sm"
          foot={count}
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button hierarchy="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  onChange(options.filter((o) => chosen.has(o.id)).map((o) => o.id));
                  setOpen(false);
                }}
              >
                Apply filter
              </Button>
            </>
          }
        >
          <WindowCard>
            <div className={own.tools}>
              {options.length > SEARCH_FROM ? (
                <SearchInput value={q} onValueChange={setQ} placeholder={`Search ${label.toLowerCase()}`} width={400} />
              ) : (
                <span className={own.toolsLabel}>{options.length.toLocaleString("en-US")} to choose from</span>
              )}
              <span className={own.toolsActions}>
                <Button size="sm" hierarchy="link" disabled={!shown.length || shown.every((o) => chosen.has(o.id))} onClick={selectShown}>
                  Select all
                </Button>
                <Button size="sm" hierarchy="link" disabled={!shown.some((o) => chosen.has(o.id))} onClick={clearShown}>
                  Clear
                </Button>
              </span>
            </div>
            <div className={`${own.list} ta-scroll`} data-search={options.length > SEARCH_FROM || undefined} role="group" aria-label={label}>
              {shown.map((o) => {
                const on = chosen.has(o.id);
                return (
                  <label key={o.id} className={own.row} data-on={on}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={(e) => toggle(o.id, e.target.checked)} />
                    <span className={own.mark} aria-hidden="true">
                      {on && <Check />}
                    </span>
                    <span className={own.name} title={o.name}>
                      {o.name}
                    </span>
                  </label>
                );
              })}
              {shown.length === 0 && (
                <p className={own.empty}>{options.length ? "Nothing matches that search." : "Nothing to filter by yet."}</p>
              )}
            </div>
          </WindowCard>
        </Window>
      )}
    </div>
  );
}
