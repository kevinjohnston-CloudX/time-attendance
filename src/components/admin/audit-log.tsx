"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format, isToday, isYesterday } from "date-fns";
import { ArrowLeft, ArrowRight, Bot, Check, ChevronDown, ChevronRight, ChevronUp, Copy, FileSearch, Lock, Search, X } from "lucide-react";
import type { AuditEntityType } from "@prisma/client";
import { Badge, Button, LinkButton, PageHeader, PinnedBar, SegmentedControl } from "@/components/ui";
import { useCondensingBar } from "@/components/layout/use-condensing-bar";
import { ENTITY_LABEL, ENTITY_TYPES, actionLabel } from "@/lib/audit/labels";

/**
 * The Audit Log, from the Audit Log handoff: search and three filters in one
 * bar, the applied filters as chips under it, the page's entries grouped by
 * day, and a side panel with everything one entry recorded.
 *
 * <p>Filtering and paging happen on the server through the query string, so
 * a filtered view is a link somebody can send. Times are shown in the
 * viewer's own timezone, which the server cannot know, so the list is drawn
 * once the page is running in the browser and a skeleton stands in before.
 */

export type AuditRow = {
  id: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  href: string | null;
};

type Filters = { q: string; type: string; actor: string; range: string };

const RANGES = [
  { id: "any", name: "Any time" },
  { id: "today", name: "Today" },
  { id: "7", name: "Last 7 days" },
  { id: "30", name: "Last 30 days" },
];
const GRID = "grid min-w-[700px] items-center gap-x-3.5 [grid-template-columns:104px_minmax(140px,1fr)_minmax(200px,1.5fr)_minmax(170px,1fr)_28px]";
const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const OVERLINE: CSSProperties = {
  font: "var(--weight-semibold) 11px/14px var(--font-sans)",
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};
const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };

const noop = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

const actorOf = (r: AuditRow) => (r.actorId ? r.actorName || "Unnamed employee" : "System");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/* ── What an entry changed ─────────────────────────────────────────────── */

type DiffRow = { field: string; before: string; after: string; removed: boolean };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function show(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "None";
  if (typeof v === "string") return ISO.test(v) && !isNaN(Date.parse(v)) ? format(new Date(v), "MMM d, yyyy h:mm a") : v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const asObject = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : x === undefined ? {} : { value: x };

/**
 * The entry's changes as rows. Entries are written in three shapes over the
 * app (before and after objects, a list of field changes, or a plain record
 * of what was done), and each reads as a table here.
 */
function diffOf(changes: unknown): { hasBefore: boolean; rows: DiffRow[] } {
  if (changes === null || changes === undefined) return { hasBefore: false, rows: [] };
  const c = asObject(changes);
  if (Array.isArray(c.fields)) {
    const rows = (c.fields as Record<string, unknown>[]).map((f) => ({
      field: String(f.field ?? f.label ?? "value"),
      before: show(f.before ?? f.from) || "None",
      after: show(f.after ?? f.to) || "None",
      removed: false,
    }));
    return { hasBefore: true, rows };
  }
  if ("before" in c || "after" in c) {
    const b = asObject(c.before);
    const a = asObject(c.after);
    const hasBefore = Object.keys(b).length > 0;
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
    return {
      hasBefore,
      rows: keys.map((k) => ({ field: k, before: show(b[k]) || "None", after: a[k] === undefined ? "Removed" : show(a[k]), removed: a[k] === undefined })),
    };
  }
  return { hasBefore: false, rows: Object.entries(c).map(([k, v]) => ({ field: k, before: "", after: show(v), removed: false })) };
}

/* ── Small parts ───────────────────────────────────────────────────────── */

function ActorAvatar({ row }: { row: AuditRow }) {
  if (!row.actorId) {
    return (
      <span className="grid h-7 w-7 flex-none place-items-center" style={{ borderRadius: 8, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-secondary)" }}>
        <Bot className="h-[15px] w-[15px]" />
      </span>
    );
  }
  return (
    <span
      className="grid h-7 w-7 flex-none place-items-center rounded-full"
      style={{ background: "var(--surface-info)", color: "var(--text-accent)", font: "var(--weight-semibold) 11px/1 var(--font-sans)" }}
    >
      {initials(actorOf(row))}
    </span>
  );
}

/** "Type All types ⌄", with a real select over it for the list itself. */
function ToolSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  const current = options.find((o) => o.id === value) ?? options[0];
  const applied = value !== options[0].id;
  return (
    <span className="ta-tool-trigger flex-none">
      {label}
      <b className="max-w-[180px] truncate" style={{ fontWeight: "var(--weight-semibold)", color: applied ? "var(--text-accent)" : "var(--text-primary)" }}>
        {current.name}
      </b>
      <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--icon-secondary)" }} />
      <select
        aria-label={label}
        value={current.id}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </span>
  );
}

function Chip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span
      className="inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap pl-2.5 pr-1"
      style={{ borderRadius: 9, background: "var(--surface-card)", boxShadow: "0 0 0 1px var(--ta-ring-strong)", font: "var(--weight-medium) 12px/1 var(--font-sans)", color: "var(--text-secondary)" }}
    >
      {label}
      <b className="min-w-0 max-w-[220px] truncate" style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-accent)" }}>{value}</b>
      <button type="button" onClick={onClear} aria-label={`Remove ${label} filter`} title="Remove filter" className="ta-icon-btn h-5 w-5" style={{ borderRadius: 6 }}>
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function CopyButton({ text, label, dark = false }: { text: string; label: string; dark?: boolean }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1800);
      },
      () => {}
    );
  };
  if (dark) {
    return (
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-6 items-center gap-1.5 px-2"
        style={{ border: 0, borderRadius: 7, background: "transparent", cursor: "pointer", font: "var(--weight-medium) 11px/1 var(--font-sans)", color: done ? "var(--wms-color-emerald-400)" : "var(--ta-code-muted)" }}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {done ? "Copied" : "Copy"}
      </button>
    );
  }
  return (
    <button type="button" onClick={copy} aria-label={`Copy ${label}`} title={done ? "Copied" : "Copy"} className="ta-icon-btn h-[26px] w-[26px]" style={{ borderRadius: 7, color: done ? "var(--icon-success)" : undefined }}>
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/* ── The screen ────────────────────────────────────────────────────────── */

export function AuditLog({
  logs,
  total,
  page,
  pages,
  actors,
  filters,
}: {
  logs: AuditRow[];
  total: number;
  page: number;
  pages: number;
  actors: { id: string; name: string }[];
  filters: Filters;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [navigating, startNav] = useTransition();
  const { barRef, markerRef, condensed } = useCondensingBar();
  const [q, setQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [view, setView] = useState("fields");
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // Back and forward bring a different search in from the address bar.
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }

  const go = (next: Partial<Filters> & { page?: number }) => {
    const f = { ...filters, ...next };
    const p = new URLSearchParams();
    if (f.q.trim()) p.set("q", f.q.trim());
    if (f.type) p.set("entityType", f.type);
    if (f.actor) p.set("actor", f.actor);
    if (f.range && f.range !== "any") {
      p.set("range", f.range);
      p.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const qs = p.toString();
    setSelId(null);
    startNav(() => router.push(`/admin/audit${qs ? `?${qs}` : ""}`, { scroll: false }));
  };

  const onSearch = (value: string) => {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => go({ q: value }), 350);
  };
  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  const typeOptions = [{ id: "", name: "All types" }, ...ENTITY_TYPES.map((t) => ({ id: t, name: ENTITY_LABEL[t] }))];
  const actorOptions = [{ id: "", name: "Anyone" }, { id: "system", name: "System" }, ...actors];
  // An actor picked from a link who has since dropped out of the list still shows by name.
  if (filters.actor && !actorOptions.some((o) => o.id === filters.actor)) {
    const named = logs.find((l) => l.actorId === filters.actor);
    actorOptions.push({ id: filters.actor, name: named ? actorOf(named) : "Selected employee" });
  }
  const rangeName = RANGES.find((r) => r.id === filters.range)?.name ?? "Any time";
  const typeName = filters.type ? ENTITY_LABEL[filters.type as AuditEntityType] ?? filters.type : "";
  const actorName = actorOptions.find((o) => o.id === filters.actor)?.name ?? "";

  const chips: { label: string; value: string; clear: Partial<Filters> }[] = [];
  if (filters.type) chips.push({ label: "Type", value: typeName, clear: { type: "" } });
  if (filters.actor) chips.push({ label: "Actor", value: actorName, clear: { actor: "" } });
  if (filters.range && filters.range !== "any") chips.push({ label: "When", value: rangeName, clear: { range: "any" } });
  if (filters.q) chips.push({ label: "Search", value: filters.q, clear: { q: "" } });
  const filtered = chips.length > 0;

  const countText = `${total.toLocaleString()} ${total === 1 ? "entry" : "entries"}`;
  const subtitle = filters.type
    ? `${total.toLocaleString()} ${typeName.toLowerCase()} ${total === 1 ? "entry" : "entries"}`
    : `${countText} · every configuration and timecard change`;

  // The page's entries under their day, in the viewer's own timezone.
  const groups: { key: string; day: string; date: string; rows: AuditRow[] }[] = [];
  if (hydrated) {
    for (const r of logs) {
      const d = new Date(r.createdAt);
      const key = format(d, "yyyy-MM-dd");
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, day: isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEEE"), date: format(d, "MMM d, yyyy"), rows: [] };
        groups.push(g);
      }
      g.rows.push(r);
    }
  }

  const idx = logs.findIndex((l) => l.id === selId);
  const sel = idx >= 0 ? logs[idx] : null;
  const move = (step: number) => {
    const next = logs[idx + step];
    if (!next) return;
    setSelId(next.id);
    rowRefs.current.get(next.id)?.scrollIntoView({ block: "nearest" });
  };
  const close = () => {
    const id = selId;
    setSelId(null);
    if (id) rowRefs.current.get(id)?.focus();
  };

  // Escape closes the panel; the arrow keys step through the page's entries.
  const keys = useRef({ close, move });
  useEffect(() => {
    keys.current = { close, move };
  });
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === "Escape") keys.current.close();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        keys.current.move(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        keys.current.move(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  const title = (
    <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      <span className="whitespace-nowrap">Audit Log</span>
      <span
        title="Entries are written once and never edited or deleted"
        className="inline-flex h-[26px] items-center gap-[7px] whitespace-nowrap rounded-full pl-2 pr-2.5"
        style={{ background: "var(--surface-card)", boxShadow: "0 0 0 1px var(--ta-ring-strong)", font: "var(--weight-medium) 12px/1 var(--font-sans)", letterSpacing: 0, color: "var(--text-secondary)" }}
      >
        <Lock className="h-3.5 w-3.5" style={{ color: "var(--icon-secondary)" }} />
        Append-only
      </span>
    </span>
  );

  return (
    <div className="relative flex flex-col gap-3.5">
      <span ref={markerRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px w-px" />
      <PinnedBar barRef={barRef}>
        <PageHeader title={title} subtitle={subtitle} condensed={condensed} />
        <div className="flex flex-col gap-2.5">
          <div
            className="relative flex min-h-12 flex-wrap items-center gap-1 py-1.5 pl-3.5 pr-1.5"
            style={{ background: "var(--surface-card)", borderRadius: 14, boxShadow: "var(--ta-toolbar-shadow)" }}
          >
            <Search className="h-[18px] w-[18px] flex-none" style={{ color: "var(--icon-secondary)" }} aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search action or record ID"
              aria-label="Search action or record ID"
              className="h-[34px] min-w-[120px] max-w-[320px] flex-[1_1_200px] border-0 bg-transparent px-2 outline-none"
              style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
            />
            <span aria-hidden className="mx-1.5 h-5 w-px flex-none" style={{ background: "var(--ta-ring-strong)" }} />
            <ToolSelect label="Type" value={filters.type} options={typeOptions} onChange={(v) => go({ type: v })} />
            <ToolSelect label="Actor" value={filters.actor} options={actorOptions} onChange={(v) => go({ actor: v })} />
            <ToolSelect label="When" value={filters.range || "any"} options={RANGES} onChange={(v) => go({ range: v })} />
            <span className="flex-1" />
            <span className="tabular whitespace-nowrap px-2.5" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {countText}
            </span>
          </div>
          {filtered && (
            <div className="-mt-1 flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <Chip key={c.label} label={c.label} value={c.value} onClear={() => go(c.clear)} />
              ))}
              <button
                type="button"
                onClick={() => go({ q: "", type: "", actor: "", range: "any" })}
                className="h-7 whitespace-nowrap rounded-lg px-2"
                style={{ border: 0, background: "transparent", cursor: "pointer", font: "var(--weight-medium) 12px/1 var(--font-sans)", color: "var(--text-accent)" }}
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </PinnedBar>

      <section
        aria-label="Audit entries"
        aria-busy={navigating || !hydrated}
        className="ta-scroll overflow-x-auto overflow-y-hidden"
        style={{ ...PANEL, opacity: navigating ? 0.6 : 1, transition: "opacity 120ms ease" }}
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 pb-16 pt-14 text-center">
            <span className="grid h-[52px] w-[52px] place-items-center" style={{ borderRadius: 16, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-disabled)" }}>
              <FileSearch className="h-[26px] w-[26px]" />
            </span>
            <span style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)", color: "var(--text-primary)" }}>
              {filters.type && chips.length === 1 ? `No ${typeName.toLowerCase()} entries` : filtered ? "No matching entries" : "No audit entries"}
            </span>
            <span className="max-w-[400px]" style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
              {filters.type && chips.length === 1 ? "Nothing of this type has been recorded." : filtered ? "Nothing in the log matches these filters." : "Nothing has been recorded yet."}
            </span>
            {filtered && (
              <Button hierarchy="secondary" size="sm" onClick={() => go({ q: "", type: "", actor: "", range: "any" })}>
                Show all entries
              </Button>
            )}
          </div>
        ) : (
          <>
            <div
              className={`${GRID} mx-1.5 mt-1.5 h-[38px] whitespace-nowrap px-3.5`}
              style={{ ...OVERLINE, borderRadius: 12, background: "var(--ta-well)" }}
            >
              <span>When</span>
              <span>Actor</span>
              <span>Action</span>
              <span>Record</span>
              <span />
            </div>
            <div className="min-w-[712px] px-1.5 pb-1 pt-0.5">
              {!hydrated
                ? Array.from({ length: Math.min(8, logs.length) }, (_, i) => (
                    <div key={i} className={`${GRID} min-h-[52px] px-3.5 py-1.5`}>
                      {[64, 120, 180, 120].map((w, j) => (
                        <span key={j} className="h-3 rounded" style={{ width: w, background: "var(--ta-skeleton)" }} />
                      ))}
                      <span />
                    </div>
                  ))
                : groups.map((g) => (
                    <div key={g.key}>
                      <div className="flex items-baseline gap-2 px-3.5 pb-1.5 pt-3.5">
                        <span style={{ font: "var(--weight-semibold) 13px/18px var(--font-sans)", color: "var(--text-primary)" }}>{g.day}</span>
                        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>{g.date}</span>
                        <span className="ml-1.5 h-px flex-1 self-center" style={{ background: "var(--stroke-divider)" }} />
                        <span className="tabular" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                          {g.rows.length} {g.rows.length === 1 ? "entry" : "entries"}
                        </span>
                      </div>
                      {g.rows.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          ref={(el) => {
                            if (el) rowRefs.current.set(r.id, el);
                            else rowRefs.current.delete(r.id);
                          }}
                          onClick={() => {
                            setSelId(r.id);
                            setView("fields");
                          }}
                          aria-current={r.id === selId ? "true" : undefined}
                          className={`ta-row-btn ${GRID} min-h-[52px] w-full border-0 bg-transparent px-3.5 py-1.5 text-left`}
                        >
                          <span className="tabular whitespace-nowrap" style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--text-secondary)" }}>
                            {format(new Date(r.createdAt), "h:mm:ss a")}
                          </span>
                          <span className="flex min-w-0 items-center gap-2.5">
                            <ActorAvatar row={r} />
                            <span className="min-w-0 truncate" style={{ font: "var(--weight-medium) 14px/20px var(--font-sans)", color: r.actorId ? "var(--text-primary)" : "var(--text-secondary)" }}>
                              {actorOf(r)}
                            </span>
                          </span>
                          <span className="flex min-w-0 flex-col gap-px">
                            <span className="truncate" style={{ font: "var(--weight-medium) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
                              {actionLabel(r.action, r.entityType)}
                            </span>
                            <code className="truncate" style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-tertiary)" }}>{r.action}</code>
                          </span>
                          <span className="flex min-w-0 items-center gap-2">
                            <Badge size="sm">{ENTITY_LABEL[r.entityType] ?? r.entityType}</Badge>
                            <code className="whitespace-nowrap" style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--text-tertiary)" }}>
                              {r.entityId.slice(0, 8)}…
                            </code>
                          </span>
                          <ChevronRight className="h-4 w-4" style={{ color: "var(--icon-disabled)" }} aria-hidden />
                        </button>
                      ))}
                    </div>
                  ))}
            </div>
            <div
              className="tabular mx-1.5 mb-1.5 flex min-w-[700px] items-center gap-2.5 py-2 pl-3.5 pr-2"
              style={{ borderRadius: 12, background: "var(--ta-well)", font: "var(--type-body2)", color: "var(--text-secondary)" }}
            >
              <span>
                Page {page.toLocaleString()} of {pages.toLocaleString()}
              </span>
              <span className="flex-1" />
              <Button hierarchy="secondary" size="sm" leadingIcon={<ArrowLeft className="h-3.5 w-3.5" />} disabled={page <= 1 || navigating} onClick={() => go({ page: page - 1 })}>
                Prev
              </Button>
              <Button hierarchy="secondary" size="sm" trailingIcon={<ArrowRight className="h-3.5 w-3.5" />} disabled={page >= pages || navigating} onClick={() => go({ page: page + 1 })}>
                Next
              </Button>
            </div>
          </>
        )}
      </section>

      {sel && hydrated && <EntryPanel row={sel} pos={`${idx + 1} of ${logs.length} on this page`} view={view} setView={setView} onClose={close} onMove={move} canPrev={idx > 0} canNext={idx < logs.length - 1} />}
    </div>
  );
}

/* ── One entry, in full ────────────────────────────────────────────────── */

function EntryPanel({
  row,
  pos,
  view,
  setView,
  onClose,
  onMove,
  canPrev,
  canNext,
}: {
  row: AuditRow;
  pos: string;
  view: string;
  setView: (v: string) => void;
  onClose: () => void;
  onMove: (step: number) => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const diff = diffOf(row.changes);
  const raw = JSON.stringify(row.changes ?? null, null, 2);
  const cols = diff.hasBefore ? "120px minmax(0,1fr) minmax(0,1fr)" : "130px minmax(0,1fr)";
  const when = new Date(row.createdAt);

  const meta: { k: string; v: ReactNode; copy?: string; mono?: boolean; muted?: boolean }[] = [
    { k: "When", v: `${format(when, "EEE, MMM d, yyyy")} at ${format(when, "h:mm:ss a")}` },
    { k: "Actor", v: actorOf(row) },
    { k: "Record", v: `${ENTITY_LABEL[row.entityType] ?? row.entityType}` },
    { k: "Record ID", v: row.entityId, copy: row.entityId, mono: true },
    { k: "IP address", v: row.ipAddress ?? "Not recorded", copy: row.ipAddress ?? undefined, mono: !!row.ipAddress, muted: !row.ipAddress },
    { k: "User agent", v: row.userAgent ?? "Not recorded", muted: !row.userAgent },
  ];

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-50" style={{ background: "var(--ta-scrim)" }} onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-entry-title"
        className="fixed bottom-3 right-3 top-3 z-[55] flex w-[440px] max-w-[calc(100vw-24px)] flex-col overflow-hidden"
        style={{ borderRadius: 18, background: "var(--surface-card)", boxShadow: "var(--ta-drop-shadow)" }}
      >
        <div className="flex flex-none items-start gap-3 pb-3.5 pl-5 pr-4 pt-[18px]">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="audit-entry-title" style={{ margin: 0, font: "var(--weight-semibold) 17px/24px var(--font-sans)", letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
              {actionLabel(row.action, row.entityType)}
            </h2>
            <code style={{ fontFamily: MONO, fontSize: 12, color: "var(--text-tertiary)", overflowWrap: "anywhere" }}>{row.action}</code>
          </span>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" title="Close" className="ta-icon-btn h-8 w-8" style={{ borderRadius: 9 }}>
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="ta-scroll flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 pb-5">
          <div style={{ borderRadius: 14, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)" }}>
            {meta.map((m, i) => (
              <div
                key={m.k}
                className="grid min-h-10 items-center gap-2.5 py-1 pl-3.5 pr-2 [grid-template-columns:96px_minmax(0,1fr)_auto]"
                style={{ boxShadow: i < meta.length - 1 ? "inset 0 -1px 0 var(--ta-well-ring)" : "none" }}
              >
                <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>{m.k}</span>
                <span
                  className="min-w-0"
                  style={{
                    font: "var(--type-body2)",
                    fontFamily: m.mono ? MONO : undefined,
                    fontSize: m.mono || m.k === "User agent" ? 12 : 13,
                    color: m.muted ? "var(--text-tertiary)" : m.k === "User agent" ? "var(--text-secondary)" : "var(--text-primary)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {m.v}
                </span>
                {m.copy ? <CopyButton text={m.copy} label={m.k} /> : <span />}
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex-1" style={OVERLINE}>Changes</span>
              <SegmentedControl
                size="sm"
                ariaLabel="Show changes as"
                items={[
                  { value: "fields", label: "Fields" },
                  { value: "json", label: "JSON" },
                ]}
                value={view}
                onChange={setView}
              />
            </div>
            {view === "fields" ? (
              <div className="overflow-hidden" style={{ borderRadius: 14, boxShadow: "inset 0 0 0 1px var(--ta-well-ring)" }}>
                <div className="grid gap-2.5 px-3.5 py-2" style={{ ...OVERLINE, gridTemplateColumns: cols, background: "var(--ta-well)" }}>
                  <span>Field</span>
                  {diff.hasBefore && <span>Before</span>}
                  <span>{diff.hasBefore ? "After" : "Recorded"}</span>
                </div>
                {diff.rows.length === 0 ? (
                  <div className="px-3.5 py-2.5" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)", boxShadow: "inset 0 1px 0 var(--stroke-divider)" }}>
                    No field changes were recorded for this entry.
                  </div>
                ) : (
                  diff.rows.map((d, i) => (
                    <div key={i} className="grid items-baseline gap-2.5 px-3.5 py-[9px]" style={{ gridTemplateColumns: cols, boxShadow: "inset 0 1px 0 var(--stroke-divider)" }}>
                      <code style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{d.field}</code>
                      {diff.hasBefore && (
                        <span style={{ font: "var(--type-body2)", color: "var(--text-error)", textDecoration: "line-through", textDecorationColor: "color-mix(in srgb, var(--text-error) 35%, transparent)", overflowWrap: "anywhere" }}>
                          {d.before}
                        </span>
                      )}
                      <span style={{ font: "var(--type-body2)", color: d.removed ? "var(--text-tertiary)" : diff.hasBefore ? "var(--text-success)" : "var(--text-primary)", overflowWrap: "anywhere" }}>
                        {d.after}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="overflow-hidden" style={{ borderRadius: 12, background: "var(--ta-code-bg)" }}>
                <div className="flex h-[34px] items-center justify-between pl-3.5 pr-2" style={{ boxShadow: "inset 0 -1px 0 var(--ta-code-rule)" }}>
                  <span style={{ font: "var(--weight-medium) 11px/1 var(--font-sans)", letterSpacing: ".04em", color: "var(--ta-code-muted)" }}>json</span>
                  <CopyButton text={raw} label="JSON" dark />
                </div>
                <pre className="m-0 overflow-x-auto whitespace-pre px-3.5 pb-3.5 pt-3" style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.7, color: "var(--ta-code-fg)" }}>
                  {raw}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-none items-center gap-2 pb-3.5 pl-5 pr-4 pt-3" style={{ boxShadow: "inset 0 1px 0 var(--stroke-divider)" }}>
          {row.href && (
            <LinkButton href={row.href} size="sm" trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
              {openLabel(row)}
            </LinkButton>
          )}
          <span className="tabular flex-1 text-right" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{pos}</span>
          <Button hierarchy="secondary" size="sm" iconOnly aria-label="Previous entry" title="Previous entry" disabled={!canPrev} onClick={() => onMove(-1)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button hierarchy="secondary" size="sm" iconOnly aria-label="Next entry" title="Next entry" disabled={!canNext} onClick={() => onMove(1)}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </aside>
    </>
  );
}

function openLabel(row: AuditRow): string {
  if (row.entityType === "PAY_PERIOD" && row.action === "SETTINGS_UPDATE") return "Open company settings";
  const map: Partial<Record<AuditEntityType, string>> = {
    TIMESHEET: "Open timecard",
    EMPLOYEE: "Open employee",
    PAY_PERIOD: "Open pay period",
    RULE_SET: "Open rule set",
    PTO_POLICY: "Open leave policy",
    ADP_SYNC: "Open ADP sync",
  };
  return map[row.entityType] ?? "Open record";
}
