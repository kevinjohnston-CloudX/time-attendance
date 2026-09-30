"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Badge, SegmentedControl, type BadgeTone } from "@/components/ui";
import { PpSelect } from "@/components/payroll/pp-select";

/**
 * The Pay Periods list, from the page handoff: the scope, a stepper through
 * the open period's own schedule with a month picker, the status filter, then
 * every period grouped by the rule set it belongs to.
 *
 * <p>Everything here writes to the query string. A payroll clerk chasing one
 * period sends the link to the supervisor who owns the blocking timesheet, and
 * a scope held in React would arrive on the current period instead.
 *
 * <p>The arrows step through the open period's own schedule (the same rule
 * set, or the company schedule), so Previous on a biweekly period is the
 * biweekly period before it. Once a month is picked they step through months
 * that hold a period instead, and a month with none is greyed in the picker:
 * the gap is itself the answer to "were those generated?".
 */

export type RailPeriod = {
  id: string;
  label: string;
  /** yyyy-MM-dd, first and last day inside the period. */
  startKey: string;
  lastKey: string;
  status: "OPEN" | "READY" | "LOCKED";
  /** The rule set's id, or "company" for a company period. */
  groupKey: string;
  groupName: string;
  freqLabel: string | null;
  total: number;
};

export type RailScope = "all" | "current" | "ytd";
export type RailStatus = "all" | "open" | "locked";

const STATUS_LABEL: Record<RailPeriod["status"], string> = { OPEN: "Open", READY: "Ready for Lock", LOCKED: "Locked" };
const STATUS_TONE: Record<RailPeriod["status"], BadgeTone> = { OPEN: "info", READY: "warning", LOCKED: "success" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };
const n = (v: number) => v.toLocaleString("en-US");

function monthKeysOf(p: RailPeriod): string[] {
  const keys: string[] = [];
  let [y, m] = p.startKey.split("-").map(Number);
  const [ey, em] = p.lastKey.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

function inMonth(p: RailPeriod, month: string): boolean {
  return monthKeysOf(p).includes(month);
}

function IconBtn({ onClick, label, disabled, children, pressed }: { onClick: () => void; label: string; disabled?: boolean; children: React.ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-expanded={pressed}
      className="ta-icon-btn h-[30px] w-[30px] disabled:cursor-default disabled:opacity-40"
      style={{ borderRadius: 8, color: "var(--icon-tertiary)", background: pressed ? "var(--surface-card)" : undefined, boxShadow: pressed ? "var(--ta-raised)" : undefined }}
    >
      {children}
    </button>
  );
}

export function PayPeriodsRail({
  periods,
  selectedId,
  scope,
  status,
  month,
  todayKey,
  keep,
}: {
  /** Every period of the company, newest first. */
  periods: RailPeriod[];
  selectedId?: string;
  scope: RailScope;
  status: RailStatus;
  month: string | null;
  todayKey: string;
  /** Query parameters that ride along on every link (site and department). */
  keep: Record<string, string>;
}) {
  const router = useRouter();
  const [picker, setPicker] = useState(false);
  const selected = periods.find((p) => p.id === selectedId);
  const [year, setYear] = useState(() => Number((month ?? selected?.startKey ?? todayKey).slice(0, 4)));
  const listRef = useRef<HTMLDivElement>(null);

  const href = (next: { id?: string; scope?: RailScope; status?: RailStatus; month?: string | null }) => {
    const p = new URLSearchParams();
    const id = next.id ?? selectedId;
    const m = next.month === undefined ? month : next.month;
    const sc = next.scope ?? scope;
    const st = next.status ?? status;
    if (id) p.set("id", id);
    if (m) p.set("month", m);
    else if (sc !== "all") p.set("filter", sc);
    if (st !== "all") p.set("status", st);
    for (const [k, v] of Object.entries(keep)) p.set(k, v);
    return `/payroll/pay-periods?${p}`;
  };
  const go = (next: Parameters<typeof href>[0]) => router.push(href(next));

  const isCurrent = (p: RailPeriod) => p.startKey <= todayKey && todayKey <= p.lastKey;
  const thisYear = todayKey.slice(0, 4);
  const list = periods.filter((p) => {
    if (month) {
      if (!inMonth(p, month)) return false;
    } else if (scope === "current") {
      if (!isCurrent(p)) return false;
    } else if (scope === "ytd") {
      if (p.startKey.slice(0, 4) !== thisYear && p.lastKey.slice(0, 4) !== thisYear) return false;
    }
    return status === "all" || p.status === status.toUpperCase();
  });

  // Grouped by rule set, newest schedule first; a rule set with nothing in
  // any of its periods here goes last.
  const groups = new Map<string, { name: string; freq: string | null; rows: RailPeriod[] }>();
  for (const p of list) {
    if (!groups.has(p.groupKey)) groups.set(p.groupKey, { name: p.groupName, freq: p.freqLabel, rows: [] });
    groups.get(p.groupKey)!.rows.push(p);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const emptyA = a.rows.every((r) => r.total === 0);
    const emptyB = b.rows.every((r) => r.total === 0);
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    return b.rows[0].startKey.localeCompare(a.rows[0].startKey) || a.name.localeCompare(b.name);
  });

  // ── The stepper ─────────────────────────────────────────────────────────
  const allMonths = [...new Set(periods.flatMap(monthKeysOf))].sort();
  const monthIdx = month ? allMonths.indexOf(month) : -1;
  const schedule = selected
    ? periods.filter((p) => p.groupKey === selected.groupKey).sort((a, b) => a.startKey.localeCompare(b.startKey))
    : [];
  const at = selected ? schedule.findIndex((p) => p.id === selected.id) : -1;

  /** A period in the month, preferring the open period's own schedule. */
  const periodForMonth = (key: string) => {
    const inIt = periods.filter((p) => inMonth(p, key));
    return (
      inIt.find((p) => p.groupKey === selected?.groupKey && p.startKey.slice(0, 7) === key) ??
      inIt.find((p) => p.groupKey === selected?.groupKey) ??
      inIt.find((p) => p.startKey.slice(0, 7) === key) ??
      inIt[0]
    );
  };
  const stepMonth = (d: -1 | 1) => {
    const key = allMonths[monthIdx + d];
    if (key) go({ month: key, id: periodForMonth(key)?.id });
  };
  const stepPeriod = (d: -1 | 1) => {
    const p = schedule[at + d];
    if (!p) return;
    // Out of the current scope, so the list widens to show where it went; a
    // status filter the new period fails is dropped for the same reason.
    const keepStatus = status === "all" || p.status === status.toUpperCase();
    go({ id: p.id, scope: "all", month: null, status: keepStatus ? status : "all" });
  };
  const monthMode = monthIdx >= 0;
  const stepLabel = monthMode && month
    ? `${MONTHS_LONG[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`
    : selected?.label ?? "No period open";

  const goToday = () => {
    const current = periods.filter(isCurrent);
    const pick = current.find((p) => p.groupKey === selected?.groupKey) ?? [...current].sort((a, b) => a.lastKey.localeCompare(b.lastKey))[0];
    setPicker(false);
    go({ id: pick?.id, scope: "current", status: "all", month: null });
  };

  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicker(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picker]);

  // The open period in view when the page lands, however far down it is.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const monthsWith = new Set(allMonths.filter((k) => k.startsWith(`${year}-`)).map((k) => Number(k.slice(5)) - 1));

  return (
    <aside
      className="flex h-[480px] w-full flex-col lg:sticky lg:top-[var(--ta-page-top)] lg:h-[var(--pp-rail-h)] lg:w-auto lg:min-w-[240px] lg:flex-[0_1_300px]"
      style={PANEL}
      aria-label="Pay periods"
    >
      <div className="flex flex-none items-center justify-between px-[18px] pb-3 pt-[18px]">
        <h1 className="m-0 whitespace-nowrap" style={{ font: "var(--weight-bold) 20px/26px var(--font-sans)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          Pay Periods
        </h1>
        <Link
          href="/payroll/timecards"
          className="ta-hoverable inline-flex h-7 items-center gap-[5px] whitespace-nowrap pl-2.5 pr-2"
          style={{ borderRadius: 8, font: "var(--weight-medium) 13px/1 var(--font-sans)", color: "var(--text-accent)", textDecoration: "none" }}
        >
          Timecards
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="relative z-[5] flex flex-none flex-col gap-2.5 px-3.5 pb-3.5">
        <SegmentedControl
          size="sm"
          fullWidth
          ariaLabel="Which periods"
          value={month ? "" : scope}
          onChange={(v) => go({ scope: v as RailScope, month: null })}
          items={[
            { value: "current", label: "Current" },
            { value: "ytd", label: "Year to date" },
            { value: "all", label: "All periods" },
          ]}
        />

        <div className="flex items-center gap-1 p-1" style={{ borderRadius: 12, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)" }}>
          <IconBtn
            label={monthMode ? "Previous month" : "Previous pay period"}
            disabled={monthMode ? monthIdx <= 0 : at <= 0}
            onClick={() => (monthMode ? stepMonth(-1) : stepPeriod(-1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </IconBtn>
          <span
            className="tabular min-w-0 flex-1 truncate text-center"
            style={{ font: "var(--weight-medium) 13px/18px var(--font-sans)", color: monthMode ? "var(--text-accent)" : "var(--text-primary)" }}
          >
            {stepLabel}
          </span>
          <IconBtn
            label={monthMode ? "Next month" : "Next pay period"}
            disabled={monthMode ? monthIdx >= allMonths.length - 1 : at < 0 || at >= schedule.length - 1}
            onClick={() => (monthMode ? stepMonth(1) : stepPeriod(1))}
          >
            <ChevronRight className="h-4 w-4" />
          </IconBtn>
          <span aria-hidden className="h-[18px] w-px flex-none" style={{ background: "var(--ta-ring-strong)" }} />
          <span className="relative">
            <IconBtn
              label="Jump to a month"
              pressed={picker}
              onClick={() => {
                if (!picker) setYear(Number((month ?? selected?.startKey ?? todayKey).slice(0, 4)));
                setPicker((v) => !v);
              }}
            >
              <Calendar className="h-4 w-4" />
            </IconBtn>
            {picker && (
              <>
                <span className="fixed inset-0 z-40" onClick={() => setPicker(false)} />
                <div
                  role="dialog"
                  aria-label="Jump to a month"
                  className="absolute right-[-4px] top-[calc(100%+6px)] z-50 w-[236px] p-2.5"
                  style={{ borderRadius: 12, background: "var(--surface-card)", boxShadow: "var(--ta-menu-shadow)" }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <IconBtn label="Previous year" onClick={() => setYear((y) => y - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </IconBtn>
                    <span className="tabular" style={{ font: "var(--weight-semibold) 13px/1 var(--font-sans)", color: "var(--text-primary)" }}>
                      {year}
                    </span>
                    <IconBtn label="Next year" onClick={() => setYear((y) => y + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </IconBtn>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {MONTHS.map((m, i) => {
                      const key = `${year}-${String(i + 1).padStart(2, "0")}`;
                      const on = key === month;
                      const has = monthsWith.has(i);
                      const now = key === todayKey.slice(0, 7);
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={!has}
                          title={has ? undefined : "No pay periods this month"}
                          onClick={() => {
                            setPicker(false);
                            go({ month: key, id: periodForMonth(key)?.id });
                          }}
                          className={has && !on ? "ta-hoverable" : undefined}
                          style={{
                            height: 32,
                            border: 0,
                            borderRadius: 8,
                            cursor: has ? "pointer" : "default",
                            font: "var(--weight-medium) 13px/1 var(--font-sans)",
                            background: on ? "var(--fill-accent)" : now && has ? "var(--surface-info)" : "transparent",
                            color: on ? "var(--text-on-accent)" : !has ? "var(--text-disabled)" : now ? "var(--text-accent)" : "var(--text-primary)",
                          }}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={goToday}
                    className="ta-hoverable mt-2 grid h-[30px] w-full place-items-center"
                    style={{ border: 0, borderRadius: 8, background: "var(--ta-well)", cursor: "pointer", font: "var(--weight-medium) 12px/1 var(--font-sans)", color: "var(--text-accent)" }}
                  >
                    Go to today
                  </button>
                </div>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <PpSelect
            label="Status"
            value={status === "all" ? "" : status}
            onChange={(v) => go({ status: (v || "all") as RailStatus })}
            options={[
              { value: "", label: "All statuses" },
              { value: "open", label: "Open" },
              { value: "locked", label: "Locked" },
            ]}
          />
          {month && (
            <span
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap pl-2.5 pr-1"
              style={{ borderRadius: 8, background: "var(--surface-info)", font: "var(--weight-medium) 12px/1 var(--font-sans)", color: "var(--text-accent)" }}
            >
              {MONTHS_LONG[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
              <button
                type="button"
                onClick={() => go({ month: null })}
                aria-label="Show every month"
                title="Show every month"
                className="grid h-5 w-5 place-items-center"
                style={{ border: 0, borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer" }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          <span className="flex-1" />
          <span className="tabular whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            {n(list.length)} {list.length === 1 ? "period" : "periods"}
          </span>
        </div>
      </div>

      <div ref={listRef} className="ta-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2.5 pt-0.5" style={{ boxShadow: "inset 0 1px 0 var(--ta-well-ring)" }}>
        {ordered.map((g) => (
          <section key={g.name + g.rows[0].id} aria-label={g.name}>
            <div className="sticky top-0 z-[2] flex items-baseline gap-1.5 px-2.5 pb-1.5 pt-3.5" style={{ background: "var(--surface-card)" }}>
              <span className="truncate" title={g.name} style={{ font: "var(--weight-semibold) 12px/16px var(--font-sans)", color: "var(--text-secondary)" }}>
                {g.name}
              </span>
              {g.freq && <span className="flex-none" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{g.freq}</span>}
            </div>
            {g.rows.map((p) => {
              const on = p.id === selectedId;
              return (
                <Link
                  key={p.id}
                  href={href({ id: p.id })}
                  aria-current={on ? "page" : undefined}
                  data-active={on ? "true" : undefined}
                  className="ta-hoverable flex flex-col gap-[7px] px-3 py-2.5"
                  style={{
                    borderRadius: 12,
                    textDecoration: "none",
                    background: on ? "var(--surface-info)" : undefined,
                    boxShadow: on ? "inset 0 0 0 1px var(--ta-nav-on-ring)" : undefined,
                    opacity: p.total === 0 && !on ? 0.6 : 1,
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="tabular min-w-0 flex-1 truncate"
                      style={{ font: "600 14px/20px var(--font-sans)", color: on ? "var(--text-accent)" : "var(--text-primary)" }}
                    >
                      {p.label}
                    </span>
                    <Badge tone={STATUS_TONE[p.status]} size="sm">
                      {STATUS_LABEL[p.status]}
                    </Badge>
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span className="tabular flex-1 whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                      {p.total === 0 ? "No timesheets" : `${n(p.total)} ${p.total === 1 ? "timesheet" : "timesheets"}`}
                    </span>
                    {/* Which row is today's, once the list holds more than today's. */}
                    {scope !== "current" && isCurrent(p) && (
                      <span className="whitespace-nowrap" style={{ font: "var(--weight-semibold) 12px/16px var(--font-sans)", color: "var(--text-accent)" }}>
                        Current
                      </span>
                    )}                  </span>
                </Link>
              );
            })}
          </section>
        ))}
        {ordered.length === 0 && (
          <div className="px-4 py-10 text-center" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            No pay periods match these filters.
          </div>
        )}
      </div>
    </aside>
  );
}
