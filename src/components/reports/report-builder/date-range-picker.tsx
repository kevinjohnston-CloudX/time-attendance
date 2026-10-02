"use client";

import { Input, SegmentedControl, Select } from "@/components/ui";
import type { DateRange } from "@/lib/validators/report.schema";
import { daysOf, describeSpan } from "@/lib/reports/period";

/**
 * The days a report covers: a pay period, two dates, or the last few days.
 *
 * <p>A pay period is the default and the first choice, because nearly every
 * report HR runs is about one. It opens on the pay period that includes
 * today rather than the newest one on file, which is usually one that has not
 * started yet and so returns nothing.
 *
 * <p>The range belongs to the builder's unsaved state, not to the URL.
 */

const RANGE_KINDS = [
  { value: "payPeriod", label: "Pay period" },
  { value: "custom", label: "Pick dates" },
  { value: "relative", label: "Recent days" },
];

/**
 * The scan reports count calendar days, so they have no pay period, and add a
 * choice for a whole week, month or year that moves on by itself: a report
 * saved as "Last month" is always the month just gone, whenever it is run.
 */
const SCAN_RANGE_KINDS = [
  { value: "custom", label: "Pick dates" },
  { value: "relative", label: "Recent days" },
  { value: "calendar", label: "Week, month or year" },
];

type Calendar = Extract<DateRange, { type: "calendar" }>;

const CALENDAR_CHOICES: { value: string; label: string; range: Calendar }[] = (
  [
    ["this", "week", "This week"],
    ["last", "week", "Last week"],
    ["this", "month", "This month"],
    ["last", "month", "Last month"],
    ["this", "year", "This year"],
    ["last", "year", "Last year"],
  ] as const
).map(([which, unit, label]) => ({ value: `${which}-${unit}`, label, range: { type: "calendar", unit, which } }));

const calendarValue = (r: Calendar) => `${r.which}-${r.unit}`;

const RELATIVE_DAYS = [7, 14, 30, 60, 90];

/** Today and Yesterday lead the recent choices, as John added them. */
const RECENT: { value: string; label: string; wide: string }[] = [
  { value: "today", label: "Today", wide: "Today" },
  { value: "yesterday", label: "Yesterday", wide: "Yesterday" },
  ...RELATIVE_DAYS.map((d) => ({ value: String(d), label: `The last ${d} days`, wide: `${d} days` })),
];

function recentValue(range: DateRange): string {
  if (range.type === "today" || range.type === "yesterday") return range.type;
  return range.type === "relative" ? String(range.relativeDays) : "";
}

function fromRecent(v: string): DateRange {
  if (v === "today" || v === "yesterday") return { type: v };
  return { type: "relative", relativeDays: Number(v) };
}

const STATUS_WORD: Record<string, string> = { OPEN: "Open", READY: "Ready to close", LOCKED: "Closed" };

export interface PayPeriodOption {
  id: string;
  startDate: string | Date;
  endDate: string | Date;
  status: string;
  /** The pay group (rule set) it belongs to. */
  groupName?: string | null;
  /** Timesheets in it, which is people. */
  people?: number;
  /** The last day worked, yyyy-mm-dd, by the period's own frequency. */
  lastDay?: string;
}

/** Date columns arrive as UTC midnight, so they are read in UTC to keep the day. */
const day = (d: string | Date, withYear: boolean) =>
  new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });

/**
 * The last day worked, yyyy-mm-dd. The server works it out from the period's
 * frequency, since weekly and biweekly periods store the day after it and
 * monthly and semi-monthly ones the day itself; failing that, the day before
 * the stored end.
 */
function lastDayKey(p: { endDate: string | Date; lastDay?: string }): string {
  return p.lastDay ?? dayKey(new Date(new Date(p.endDate).getTime() - 86400000));
}

/** Today on this computer's calendar, yyyy-mm-dd. */
const todayKey = () => new Date().toLocaleDateString("en-CA");

/**
 * The pay period to open on: of those that include today, the one with the
 * most people in it, since every pay group has its own and most are empty.
 * Failing that, the latest one that has started.
 */
export function currentPayPeriod(payPeriods: PayPeriodOption[]): PayPeriodOption | undefined {
  const now = Date.now();
  const started = payPeriods
    .filter((p) => new Date(p.startDate).getTime() <= now)
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  const current = started.filter((p) => isCurrent(p)).sort((a, b) => (b.people ?? 0) - (a.people ?? 0));
  return current[0] ?? started[0] ?? payPeriods[payPeriods.length - 1];
}

/** Whether a pay period includes today, counted in whole days. */
const isCurrent = (p: { startDate: string | Date; endDate: string | Date; lastDay?: string }) => {
  const today = todayKey();
  return dayKey(p.startDate) <= today && today <= lastDayKey(p);
};

/**
 * The order the list reads in: what is running now, biggest first, then the
 * past newest first, then what has not started yet, soonest first.
 */
function byWhen<T extends { startDate: string | Date; endDate: string | Date; people?: number }>(list: T[]): T[] {
  const now = Date.now();
  const rank = (p: T) => (isCurrent(p) ? 0 : new Date(p.startDate).getTime() > now ? 2 : 1);
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    // Several pay periods can be running at once, one per cadence: the
    // biggest first.
    if (rank(a) === 0 && (b.people ?? 0) !== (a.people ?? 0)) return (b.people ?? 0) - (a.people ?? 0);
    const d = new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
    return rank(a) === 2 ? -d : d;
  });
}

/** The calendar day a stored bound falls on, as yyyy-mm-dd in UTC. */
const dayKey = (d: string | Date) => new Date(d).toISOString().slice(0, 10);

const NO_GROUP = "No pay group";

/** Pay group names, the ones with people in them first. */
function groupNames(payPeriods: PayPeriodOption[]): string[] {
  const people = new Map<string, number>();
  for (const p of payPeriods) {
    const k = p.groupName ?? NO_GROUP;
    people.set(k, Math.max(people.get(k) ?? 0, p.people ?? 0));
  }
  return [...people.entries()]
    .sort((a, b) => Number(b[1] > 0) - Number(a[1] > 0) || a[0].localeCompare(b[0]))
    .map(([k]) => k);
}

type Span = { key: string; rep: PayPeriodOption; startDate: string | Date; endDate: string | Date; lastDay?: string; people: number };

/**
 * Every distinct run of pay period dates across all pay groups, newest
 * first, each counting the people in every group whose pay period falls
 * inside it: a weekly group's two weeks count toward a biweekly fortnight.
 * The period that stands for it is the one with the most people.
 */
function spans(payPeriods: PayPeriodOption[]): Span[] {
  const byKey = new Map<string, PayPeriodOption[]>();
  for (const p of payPeriods) {
    const k = `${dayKey(p.startDate)}|${dayKey(p.endDate)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  return [...byKey.entries()]
    .map(([key, same]) => {
      const [from, to] = key.split("|");
      const inside = payPeriods.filter((p) => dayKey(p.startDate) >= from && dayKey(p.endDate) <= to);
      const perGroup = new Map<string, number>();
      for (const p of inside) {
        const g = p.groupName ?? NO_GROUP;
        perGroup.set(g, Math.max(perGroup.get(g) ?? 0, p.people ?? 0));
      }
      const rep = [...same].sort((a, b) => (b.people ?? 0) - (a.people ?? 0))[0];
      return {
        key,
        rep,
        startDate: rep.startDate,
        endDate: rep.endDate,
        lastDay: rep.lastDay,
        people: [...perGroup.values()].reduce((n, v) => n + v, 0),
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key) || b.people - a.people);
}

/** "Sep 13 to Sep 26, 2026 · Current · 841 people", for one option. */
function optionText(p: { startDate: string | Date; endDate: string | Date; lastDay?: string; status?: string; people?: number }): string {
  const last = lastDayKey(p);
  const tag = isCurrent(p)
    ? "Current"
    : new Date(p.startDate).getTime() > Date.now()
      ? "Upcoming"
      : p.status
        ? STATUS_WORD[p.status] ?? p.status
        : "Past";
  const who = p.people === undefined ? "" : p.people === 0 ? " · No one" : ` · ${p.people} ${p.people === 1 ? "person" : "people"}`;
  return `${day(p.startDate, false)} to ${day(last, true)} · ${tag}${who}`;
}

/** The dates in words: "Sep 13 to Sep 26, 2026 · All pay groups". */
export function describeRange(range: DateRange | undefined, payPeriods: PayPeriodOption[]): string {
  if (!range) return "Not set";
  if (range.type === "calendar") {
    const label = CALENDAR_CHOICES.find((c) => c.value === calendarValue(range))?.label ?? "A calendar period";
    return `${label} · ${describeSpan(daysOf(range))}`;
  }
  if (range.type === "relative") return `The last ${range.relativeDays} days`;
  if (range.type === "today") return "Today";
  if (range.type === "yesterday") return "Yesterday";
  if (range.type === "custom") {
    if (!range.startDate || !range.endDate) return "Dates not picked yet";
    return `${day(range.startDate, false)} to ${day(range.endDate, true)}`;
  }
  const pp = payPeriods.find((p) => p.id === range.payPeriodId);
  if (!pp) return "A pay period that is no longer on file";
  const last = lastDayKey(pp);
  const who = range.allGroups ? "All pay groups" : pp.groupName ?? "One pay group";
  return `${day(pp.startDate, false)} to ${day(last, true)} · ${who}`;
}

/** The range to open on: every pay group, over the current pay period's dates. */
export function defaultPayPeriodRange(payPeriods: PayPeriodOption[]): DateRange | null {
  const pp = currentPayPeriod(payPeriods);
  return pp ? { type: "payPeriod", payPeriodId: pp.id, allGroups: true } : null;
}

export function DateRangePicker({
  value,
  onChange,
  payPeriods,
  stacked = false,
  scan = false,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  payPeriods: PayPeriodOption[];
  /** A scan report: calendar days, no pay periods, and whole weeks, months and years. */
  scan?: boolean;
  /** Every control the full width of a narrow column, as in the builder's side rail. */
  stacked?: boolean;
}) {
  const current = currentPayPeriod(payPeriods);

  function pickKind(kind: string) {
    if (kind === "payPeriod" && current) {
      onChange({ type: "payPeriod", payPeriodId: current.id, allGroups: true });
    } else if (kind === "custom") {
      onChange({ type: "custom", startDate: "", endDate: "" });
    } else if (kind === "calendar") {
      onChange({ type: "calendar", unit: "month", which: "last" });
    } else if (scan) {
      onChange({ type: "yesterday" });
    } else {
      onChange({ type: "relative", relativeDays: 14 });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        items={scan ? SCAN_RANGE_KINDS : payPeriods.length ? RANGE_KINDS : RANGE_KINDS.filter((k) => k.value !== "payPeriod")}
        value={value.type === "today" || value.type === "yesterday" ? "relative" : value.type}
        onChange={pickKind}
        ariaLabel="How to pick the dates"
        fullWidth={stacked}
      />

      {value.type === "payPeriod" && (
        <PayPeriodFields value={value} onChange={onChange} payPeriods={payPeriods} stacked={stacked} />
      )}

      {value.type === "custom" && (
        <div
          className={
            stacked
              ? "grid grid-cols-2 gap-2"
              : "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,46%)),1fr))] sm:max-w-[420px]"
          }
        >
          <Input
            type="date"
            label="From"
            value={value.startDate}
            onChange={(e) => onChange({ ...value, startDate: e.target.value })}
          />
          <Input
            type="date"
            label="To"
            value={value.endDate}
            onChange={(e) => onChange({ ...value, endDate: e.target.value })}
          />
        </div>
      )}

      {value.type === "calendar" && (
        <Select
          value={calendarValue(value)}
          onChange={(e) => {
            const pick = CALENDAR_CHOICES.find((c) => c.value === e.target.value);
            if (pick) onChange(pick.range);
          }}
          aria-label="Which period"
          style={stacked ? undefined : { maxWidth: 260 }}
        >
          {CALENDAR_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      )}

      {value.type === "calendar" && (
        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
          {describeSpan(daysOf(value))}{value.unit === "week" ? ". Weeks run Monday to Sunday." : ""}
        </span>
      )}

      {/* Seven choices do not fit a narrow column side by side. */}
      {recentValue(value) && stacked && (
        <Select value={recentValue(value)} onChange={(e) => onChange(fromRecent(e.target.value))} aria-label="Which days">
          {RECENT.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      )}

      {recentValue(value) && !stacked && (
        <SegmentedControl
          items={RECENT.map((r) => ({ value: r.value, label: r.wide }))}
          value={recentValue(value)}
          onChange={(v) => onChange(fromRecent(v))}
          ariaLabel="Which days"
        />
      )}
    </div>
  );
}

/**
 * Which pay group, then which pay period. "All pay groups" is the default
 * and lists each run of dates once; a single group lists its own periods.
 * A saved report from before this choice existed kept one pay period, so it
 * opens on that period's group.
 */
function PayPeriodFields({
  value,
  onChange,
  payPeriods,
  stacked,
}: {
  value: Extract<DateRange, { type: "payPeriod" }>;
  onChange: (range: DateRange) => void;
  payPeriods: PayPeriodOption[];
  stacked: boolean;
}) {
  const selected = payPeriods.find((p) => p.id === value.payPeriodId);
  const group = value.allGroups ? "" : selected?.groupName ?? NO_GROUP;
  const all = byWhen(spans(payPeriods));
  const selectedSpan = selected ? `${dayKey(selected.startDate)}|${dayKey(selected.endDate)}` : "";
  const inGroup = byWhen(payPeriods.filter((p) => (p.groupName ?? NO_GROUP) === group));

  function pickGroup(g: string) {
    if (!g) {
      const span = all.find((x) => x.key === selectedSpan) ?? all.find((x) => isCurrent(x)) ?? all[0];
      if (span) onChange({ type: "payPeriod", payPeriodId: span.rep.id, allGroups: true });
      return;
    }
    const mine = payPeriods.filter((p) => (p.groupName ?? NO_GROUP) === g);
    // Stay on the same dates when the group has them, else its current one.
    const same = mine.find((p) => `${dayKey(p.startDate)}|${dayKey(p.endDate)}` === selectedSpan);
    const next = same ?? currentPayPeriod(mine) ?? mine[0];
    if (next) onChange({ type: "payPeriod", payPeriodId: next.id, allGroups: false });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={stacked ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"}>
        <Select value={group} onChange={(e) => pickGroup(e.target.value)} aria-label="Pay group" style={stacked ? undefined : { flex: "0 1 260px" }}>
          <option value="">All pay groups</option>
          {groupNames(payPeriods).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <Select
          value={group ? value.payPeriodId : all.find((x) => x.key === selectedSpan)?.rep.id ?? value.payPeriodId}
          onChange={(e) => onChange({ type: "payPeriod", payPeriodId: e.target.value, allGroups: !group })}
          aria-label="Pay period"
          style={stacked ? undefined : { flex: "1 1 320px", maxWidth: 400 }}
        >
          {group
            ? inGroup.map((pp) => (
                <option key={pp.id} value={pp.id}>
                  {optionText(pp)}
                </option>
              ))
            : all.map((x) => (
                <option key={x.key} value={x.rep.id}>
                  {optionText(x)}
                </option>
              ))}
        </Select>
      </div>
      <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
        {group
          ? "Only the people in this pay group."
          : "Everyone whose pay period falls inside these dates, in every pay group."}
      </span>
    </div>
  );
}
