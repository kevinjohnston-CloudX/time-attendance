"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import { X } from "lucide-react";
import { Badge, Banner, Button, Checkbox, SearchInput, SegmentedControl, Select, statusTone } from "@/components/ui";

/**
 * The parts every Company Setup area is built from, so the eight of them read
 * as one screen: the area's panel (its name, one quiet line, the one action,
 * then search and the Active / Inactive / All filter over the rows), the edit
 * window every row opens, and the small pieces inside both.
 *
 * <p>Each area used to carry its own copy of the modal, the labelled select
 * and the form buttons, and they had drifted apart: three kinds of delete
 * confirmation, two error styles, one area with no errors at all.
 */

/* ── The area panel ───────────────────────────────────────────────────── */

export type StatusView = "active" | "inactive" | "all";

/** The status filter's state and the rows it keeps, with a count for each view. */
export function useStatusView<T extends { isActive: boolean }>(rows: T[], initial: StatusView = "active") {
  const [view, setView] = useState<StatusView>(initial);
  const counts = {
    active: rows.filter((r) => r.isActive).length,
    inactive: rows.filter((r) => !r.isActive).length,
    all: rows.length,
  };
  const kept = view === "all" ? rows : rows.filter((r) => (view === "active" ? r.isActive : !r.isActive));
  return { view, setView, counts, kept };
}

/**
 * Opens a record's window when the address names one, then takes the name
 * off the address so a reload does not open it again. It is how a link from
 * elsewhere lands on the record itself: an employee's Pay & Rules, or the
 * one page per form addresses the classic design uses. `?edit=<id>` opens
 * that record, `?new=1` an empty form.
 */
export function useOpenFromLink<T extends { id: string }>(rows: T[], open: (row: T | "new") => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const url = new URL(window.location.href);
    const edit = url.searchParams.get("edit");
    const isNew = url.searchParams.get("new") === "1";
    if (!edit && !isNew) return;
    const row = edit ? rows.find((r) => r.id === edit) : undefined;
    url.searchParams.delete("edit");
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    // After this render, so opening the window is not a state change made
    // while the effect runs. Not cancelled on the next render: the caller's
    // open changes every render, and the ref above already makes this once.
    setTimeout(() => {
      if (row) open(row);
      else if (isNew) open("new");
    }, 0);
  }, [rows, open]);
}

/* ── Summary tiles ────────────────────────────────────────────────────── */

/**
 * One figure over an area's list, the Dashboard's Team Presence tile. A fact
 * with `match` is also a filter: pressing its tile narrows the list to the
 * rows it counts, pressing it again shows them all. A fact with `value` only
 * reports, and is drawn flat so it does not read as a button.
 */
export type Fact<T> = {
  key: string;
  label: string;
  note: string;
  match?: (row: T) => boolean;
  value?: number;
};

/** The tiles' counts, which one is pressed, and the rows it keeps. */
export function useFacts<T>(rows: T[], facts: Fact<T>[]) {
  const [focus, setFocus] = useState<string | null>(null);
  const picked = facts.find((f) => f.key === focus && f.match);
  const tiles = facts.map((f) => ({
    key: f.key,
    label: f.label,
    note: f.note,
    count: f.value ?? (f.match ? rows.filter(f.match).length : 0),
    filters: !!f.match,
    pressed: !!picked && f.key === picked.key,
  }));
  return {
    tiles,
    kept: picked ? rows.filter(picked.match!) : rows,
    toggle: (key: string) => setFocus((k) => (k === key ? null : key)),
    clear: () => setFocus(null),
    focused: !!picked,
  };
}

type TileData = ReturnType<typeof useFacts>["tiles"][number];

export function FactTiles({ tiles, onToggle }: { tiles: TileData[]; onToggle: (key: string) => void }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
      {tiles.map((t) => {
        const body = (
          <>
            <span className="wms-overline truncate">{t.label}</span>
            <span
              className="tabular"
              style={{ font: "var(--weight-semibold) 22px/28px var(--font-sans)", color: t.pressed ? "var(--text-accent)" : "var(--text-primary)" }}
            >
              {t.count.toLocaleString()}
            </span>
            <span className="truncate" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }} title={t.note}>
              {t.note}
            </span>
          </>
        );
        return t.filters ? (
          <button
            key={t.key}
            type="button"
            aria-pressed={t.pressed}
            title={t.pressed ? "Show all" : `Show only these: ${t.label.toLowerCase()}`}
            onClick={() => onToggle(t.key)}
            className={`flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              t.pressed
                ? "border-[var(--stroke-accent)] bg-[var(--surface-info)]"
                : "border-[var(--stroke-divider)] bg-[var(--surface-card)] hover:border-[var(--stroke-hover)]"
            }`}
          >
            {body}
          </button>
        ) : (
          <div
            key={t.key}
            className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-[var(--stroke-divider)] bg-[var(--surface-secondary)] px-3 py-2.5"
          >
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function AreaPanel({
  title,
  hint,
  action,
  summary,
  search,
  status,
  filters,
  count,
  children,
}: {
  title: string;
  /** One quiet line: what this area is for. */
  hint: string;
  /** The area's one primary action, usually Add. */
  action?: ReactNode;
  /** Figures over the list, usually FactTiles. */
  summary?: ReactNode;
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  status?: { view: StatusView; onChange: (v: StatusView) => void; counts: Record<StatusView, number> };
  /** Anything else the area filters by, after the status. */
  filters?: ReactNode;
  /** "12 sites", or "3 of 12 sites" when narrowed. */
  count?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="ta-card flex min-w-0 flex-col"
      style={{ borderRadius: "var(--radius-l)", overflow: "clip" }}
    >
      <header className="flex flex-wrap items-start gap-3 px-5 pb-3 pt-4">
        <span className="flex min-w-[220px] flex-1 flex-col gap-0.5">
          <h2 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{title}</h2>
          <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            {hint}
          </p>
        </span>
        {action && <span className="flex flex-none items-center gap-2">{action}</span>}
      </header>

      {summary && <div className="px-5 pb-3.5">{summary}</div>}

      {(search || status || filters || count) && (
        <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3.5">
          {status && (
            <SegmentedControl
              ariaLabel="Status"
              value={status.view}
              onChange={(v) => status.onChange(v as StatusView)}
              items={[
                { value: "active", label: "Active", count: status.counts.active },
                { value: "inactive", label: "Inactive", count: status.counts.inactive },
                { value: "all", label: "All", count: status.counts.all },
              ]}
            />
          )}
          {search && (
            <SearchInput value={search.value} onValueChange={search.onChange} placeholder={search.placeholder} width={240} />
          )}
          {filters}
          {count && (
            <span
              className="tabular ml-auto whitespace-nowrap"
              style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
            >
              {count}
            </span>
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--stroke-divider)" }}>{children}</div>
    </section>
  );
}

/** "12 sites", or "3 of 12 sites" once a search or filter has narrowed them. */
export function countLine(shown: number, total: number, one: string, many: string): string {
  const word = total === 1 ? one : many;
  return shown === total ? `${total.toLocaleString()} ${word}` : `${shown.toLocaleString()} of ${total.toLocaleString()} ${word}`;
}

/** Case-insensitive match of a search against any of the given texts. */
export function matches(q: string, ...texts: (string | number | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return texts.some((t) => t != null && String(t).toLowerCase().includes(needle));
}

export function StatusBadge({ active }: { active: boolean }) {
  // Neutral for inactive: statusTone answers amber for a value it does not
  // know, and amber reads as something to go and fix.
  return active ? (
    <Badge tone={statusTone("ACTIVE")} size="sm" dot>
      Active
    </Badge>
  ) : (
    <Badge size="sm">Inactive</Badge>
  );
}

/** Nothing recorded, drawn quietly so it never reads as a value. */
export function Muted({ children = "None" }: { children?: ReactNode }) {
  return <span style={{ color: "var(--text-tertiary)" }}>{children}</span>;
}

/* ── The edit window ──────────────────────────────────────────────────── */

/** Two fields a row where there is room, one where there is not. */
export const FIELD_GRID = "grid gap-x-4 gap-y-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,46%)),1fr))]";

/**
 * Add or edit one record: its name, the fields, then Cancel and Save at the
 * foot, with Delete on the left when the area allows it. Escape, the X and the
 * scrim close it; nothing is saved until Save.
 *
 * <p>With an icon, the header is the product's form window header (the Pay
 * Periods handoff's): the area's glyph on a tile, the title at the design
 * system's modal size, and one line under it saying what the record is.
 */
export function SetupDialog({
  title,
  subtitle,
  icon,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
  danger,
  width = 560,
  children,
}: {
  title: string;
  subtitle?: string;
  /** The area's glyph, 18px, the same one its empty state draws. */
  icon?: ReactNode;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onClose: () => void;
  /** Delete, drawn at the foot's left. See DeleteAction. */
  danger?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(3, 7, 18, 0.5)" }}
      onClick={(e) => e.target === e.currentTarget && !pending && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-dialog-title"
        className="ta-modal flex max-h-[calc(100dvh-2rem)] w-full flex-col"
        style={{ maxWidth: width, borderRadius: "var(--radius-l)" }}
      >
        <header
          className={`flex flex-none items-start gap-3 px-5 ${icon ? "pb-4 pt-5" : "pb-3.5 pt-4"}`}
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          {icon && (
            <span
              className="grid h-[38px] w-[38px] flex-none place-items-center"
              style={{ borderRadius: 11, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-tertiary)" }}
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2
              id="setup-dialog-title"
              className="truncate"
              style={{ margin: 0, font: icon ? "var(--type-h3)" : "var(--type-h4)", color: "var(--text-primary)" }}
            >
              {title}
            </h2>
            {subtitle && (
              <span style={{ font: "var(--type-body2)", color: icon ? "var(--text-secondary)" : "var(--text-tertiary)" }}>{subtitle}</span>
            )}
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} disabled={pending} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            if (!pending) onSubmit(new FormData(e.currentTarget));
          }}
        >
          <div className="ta-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            {error && <Banner tone="error" title="Not saved" body={error} />}
            {children}
          </div>
          <footer className="flex flex-none items-center gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
            <span className="flex min-w-0 flex-1 items-center">{danger}</span>
            <Button type="button" hierarchy="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/**
 * Delete, asked twice in place: the first click turns the link into the
 * question and a red button, so a slip of the mouse deletes nothing.
 */
export function DeleteAction({
  label,
  question,
  pending,
  onDelete,
}: {
  label: string;
  question: string;
  pending: boolean;
  onDelete: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button type="button" hierarchy="link" tone="error" size="sm" onClick={() => setAsking(true)} disabled={pending}>
        {label}
      </Button>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-error)" }}>
        {question}
      </span>
      <Button type="button" size="sm" tone="error" onClick={onDelete} disabled={pending}>
        {pending ? "Deleting…" : "Delete"}
      </Button>
      <Button type="button" size="sm" hierarchy="tertiary" onClick={() => setAsking(false)} disabled={pending}>
        Keep
      </Button>
    </span>
  );
}

/** A select with the same label over it as the kit's Input. */
export function SelectField({
  label,
  hint,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex w-full min-w-0 flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <Select {...rest} style={{ width: "100%" }}>
        {children}
      </Select>
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
    </label>
  );
}

/** Active or inactive, as a pair of choices rather than a select, since it is one of two. */
export function StatusField({
  defaultActive,
  name = "isActive",
  hint,
  bare = false,
}: {
  defaultActive: boolean;
  name?: string;
  hint?: string;
  /** Leave out the label, where the row beside it already names the field. */
  bare?: boolean;
}) {
  const [active, setActive] = useState(defaultActive);
  return (
    <div className="flex flex-col items-start gap-1.5">
      {!bare && <span className="wms-label">Status</span>}
      <SegmentedControl
        ariaLabel="Status"
        value={active ? "true" : "false"}
        onChange={(v) => setActive(v === "true")}
        items={[
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ]}
      />
      <input type="hidden" name={name} value={active ? "true" : "false"} />
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
    </div>
  );
}

/** Words for the codes withRBAC answers with, so nobody reads FORBIDDEN in a banner. */
export function saveError(error: string): string {
  if (error === "FORBIDDEN") return "You do not have permission to change this.";
  if (error === "UNAUTHENTICATED") return "Your session has ended. Sign in again to save.";
  if (error === "NOT_FOUND") return "This record no longer exists. Reload the page.";
  // A failed schema check arrives as its raw JSON list of issues.
  if (error.trim().startsWith("[")) return "Some fields are missing or not valid. Check them and try again.";
  return error;
}

/** Leave categories in words; the enum values are not for people to read. */
export const LEAVE_CATEGORY_LABEL: Record<string, string> = {
  PTO: "Paid time off",
  SICK: "Sick",
  HOLIDAY: "Holiday",
  FMLA: "FMLA",
  BEREAVEMENT: "Bereavement",
  JURY_DUTY: "Jury duty",
  MILITARY: "Military",
  UNPAID: "Unpaid",
};

/**
 * Pick several from a list: a department's sites, a holiday's rules. Ticks
 * rather than a two box shuttle, with Select all and Clear, a search once the
 * list is long, and how many are picked. The picked ids also go in a hidden
 * field under `name`, comma separated, for forms that read FormData.
 */
export function PickList({
  label,
  hint,
  items,
  selected,
  onChange,
  name,
  searchPlaceholder = "Search",
  invalid = false,
}: {
  label: string;
  hint?: string;
  items: { id: string; label: string; note?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  name?: string;
  searchPlaceholder?: string;
  /** Drawn in the error colour, for a list that needs at least one. */
  invalid?: boolean;
}) {
  const [q, setQ] = useState("");
  const picked = new Set(selected);
  const shown = items.filter((i) => matches(q, i.label, i.note));
  const allShownPicked = shown.length > 0 && shown.every((i) => picked.has(i.id));

  function toggle(id: string) {
    onChange(picked.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }
  function setShown(on: boolean) {
    const ids = new Set(shown.map((i) => i.id));
    onChange(on ? [...new Set([...selected, ...ids])] : selected.filter((s) => !ids.has(s)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <span className="wms-label min-w-0 flex-1">{label}</span>
        <span className="tabular" style={{ font: "var(--type-caption1)", color: invalid ? "var(--text-error)" : "var(--text-tertiary)" }}>
          {selected.length} of {items.length} picked
        </span>
      </span>
      <div
        className="flex flex-col overflow-hidden"
        style={{
          border: `1px solid ${invalid ? "var(--stroke-error)" : "var(--stroke-default)"}`,
          borderRadius: "var(--radius-m)",
        }}
      >
        <div
          className="flex items-center gap-2 px-2.5 py-2"
          style={{ borderBottom: "1px solid var(--stroke-divider)", background: "var(--surface-secondary)" }}
        >
          {items.length > 8 ? (
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="ta-field h-7 min-w-0 flex-1 rounded-md px-2"
              style={{ border: "1px solid var(--stroke-default)", background: "var(--surface-card)", font: "var(--type-body2)", color: "var(--text-primary)" }}
            />
          ) : (
            <span className="flex-1" />
          )}
          <Button type="button" size="sm" hierarchy="link" onClick={() => setShown(!allShownPicked)} disabled={shown.length === 0}>
            {allShownPicked ? "Clear" : q ? "Select these" : "Select all"}
          </Button>
        </div>
        <div className="ta-scroll grid max-h-[232px] gap-x-4 overflow-y-auto px-3 py-2 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
          {shown.length === 0 ? (
            <span className="py-2" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {items.length ? "Nothing matches that search." : "There is nothing to pick yet."}
            </span>
          ) : (
            shown.map((i) => (
              <span key={i.id} className="flex min-w-0 items-center py-1">
                <Checkbox
                  checked={picked.has(i.id)}
                  onChange={() => toggle(i.id)}
                  label={
                    <span className="inline-flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate">{i.label}</span>
                      {i.note && (
                        <span className="whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                          {i.note}
                        </span>
                      )}
                    </span>
                  }
                />
              </span>
            ))
          )}
        </div>
      </div>
      {hint && (
        <span style={{ font: "var(--type-caption1)", color: invalid ? "var(--text-error)" : "var(--text-tertiary)" }}>{hint}</span>
      )}
      {name && <input type="hidden" name={name} value={selected.join(",")} />}
    </div>
  );
}

/** One of a few plain choices, drawn as segments, with the value in a hidden field under `name`. */
export function ChoiceField({
  label,
  name,
  options,
  defaultValue,
  hint,
  onChange,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue: string;
  hint?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      {label && <span className="wms-label">{label}</span>}
      <SegmentedControl
        ariaLabel={label || name}
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        items={options}
      />
      <input type="hidden" name={name} value={value} />
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}>{hint}</span>}
    </div>
  );
}

/** "80 h", "7 h 30 min", "45 min". */
export function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h.toLocaleString()} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") || "0 h";
}

/* ── Times and honesty notes ──────────────────────────────────────────── */

/** "HH:mm" (24 hour, as stored) to what a person types: 8:30 and PM. */
function splitClock(v: string | null | undefined): { text: string; half: "AM" | "PM" } {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? "");
  if (!m) return { text: "", half: "AM" };
  const h = Number(m[1]);
  return { text: `${h % 12 || 12}:${m[2]}`, half: h >= 12 ? "PM" : "AM" };
}

/** What was typed back to "HH:mm", or null when it is not a time. */
function joinClock(text: string, half: "AM" | "PM"): string | null {
  const t = text.trim().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h < 1 || h > 12 || min > 59) return null;
  const h24 = (h % 12) + (half === "PM" ? 12 : 0);
  return `${String(h24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * A time of day on a 12 hour clock, with AM or PM as a control of its own
 * rather than guessed. Submits "HH:mm" under `name`, or "" when empty. A
 * time it cannot read marks itself invalid, so a form can refuse to save.
 */
export function ClockField({
  name,
  defaultValue,
  label,
  onChange,
}: {
  name: string;
  defaultValue?: string | null;
  /** Read out to screen readers; the visible label sits beside it. */
  label: string;
  onChange?: () => void;
}) {
  const start = splitClock(defaultValue);
  const [text, setText] = useState(start.text);
  const [half, setHalf] = useState<"AM" | "PM">(start.half);
  const value = text.trim() ? joinClock(text, half) : "";
  const invalid = value === null;
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <input
          aria-label={label}
          aria-invalid={invalid || undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange?.();
          }}
          placeholder="8:00"
          inputMode="numeric"
          autoComplete="off"
          className="ta-field tabular h-8 w-[72px] rounded-md px-2.5"
          style={{
            border: `1px solid ${invalid ? "var(--stroke-error)" : "var(--stroke-default)"}`,
            background: "var(--surface-card)",
            color: "var(--text-primary)",
            font: "var(--type-body1)",
          }}
        />
        <SegmentedControl
          ariaLabel={`${label}, AM or PM`}
          value={half}
          onChange={(v) => {
            setHalf(v as "AM" | "PM");
            onChange?.();
          }}
          items={[
            { value: "AM", label: "AM" },
            { value: "PM", label: "PM" },
          ]}
        />
      </span>
      {invalid && <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>Use a time like 8:30</span>}
      <input type="hidden" name={name} value={value ?? ""} />
    </span>
  );
}

/**
 * Marks a setting that is saved but that no calculation reads yet, so the
 * screen does not promise behaviour the system does not have.
 */
export function NotCalculated() {
  return (
    <span title="CloudTime saves this setting, but pay calculations do not use it yet.">
      <Badge size="sm">Not used in pay yet</Badge>
    </span>
  );
}

/** "HH:mm" as a person reads it: "8:00 AM". Empty for no time. */
export function clock12(v: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

/**
 * ClockField for a time held in state rather than submitted by name: the
 * week schedule keeps all seven days in one value. It reports "HH:mm", or
 * null once cleared; a time it cannot read (or an empty required one) marks
 * itself invalid and reports nothing, so the last good value stands.
 */
export function ClockInput({
  value,
  onChange,
  label,
  required = false,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  required?: boolean;
}) {
  const [text, setText] = useState(() => splitClock(value).text);
  const [half, setHalf] = useState<"AM" | "PM">(() => splitClock(value).half);
  // Follow a value set from outside, such as "Set every workday".
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    const next = splitClock(value);
    setText(next.text);
    setHalf(next.half);
  }
  const parsed = text.trim() ? joinClock(text, half) : null;
  const invalid = text.trim() ? parsed === null : required;

  function commit(nextText: string, nextHalf: "AM" | "PM") {
    const v = nextText.trim() ? joinClock(nextText, nextHalf) : null;
    if (nextText.trim() && v === null) return;
    if (!nextText.trim() && required) return;
    setSeen(v);
    onChange(v);
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <input
          aria-label={label}
          aria-invalid={invalid || undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value, half);
          }}
          placeholder="8:00"
          inputMode="numeric"
          autoComplete="off"
          className="ta-field tabular h-8 w-[72px] rounded-md px-2.5"
          style={{
            border: `1px solid ${invalid ? "var(--stroke-error)" : "var(--stroke-default)"}`,
            background: "var(--surface-card)",
            color: "var(--text-primary)",
            font: "var(--type-body1)",
          }}
        />
        <SegmentedControl
          ariaLabel={`${label}, AM or PM`}
          value={half}
          onChange={(v) => {
            setHalf(v as "AM" | "PM");
            commit(text, v as "AM" | "PM");
          }}
          items={[
            { value: "AM", label: "AM" },
            { value: "PM", label: "PM" },
          ]}
        />
      </span>
      {invalid && (
        <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>
          {text.trim() ? "Use a time like 8:30" : "Enter a time"}
        </span>
      )}
    </span>
  );
}
