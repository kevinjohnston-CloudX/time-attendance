"use client";

import { Input, SegmentedControl, Select } from "@/components/ui";
import type { DateRange } from "@/lib/validators/report.schema";

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
  { value: "relative", label: "Last few days" },
];

const RELATIVE_DAYS = [7, 14, 30, 60, 90];

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
 * The pay period to open on: of those that include today, the one with the
 * most people in it, since every pay group has its own and most are empty.
 * Failing that, the latest one that has started. The stored end is the day
 * after the last day worked.
 */
export function currentPayPeriod(payPeriods: PayPeriodOption[]): PayPeriodOption | undefined {
  const now = Date.now();
  const started = payPeriods
    .filter((p) => new Date(p.startDate).getTime() <= now)
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  const current = started
    .filter((p) => now < new Date(p.endDate).getTime())
    .sort((a, b) => (b.people ?? 0) - (a.people ?? 0));
  return current[0] ?? started[0] ?? payPeriods[payPeriods.length - 1];
}

/** Whether a pay period includes today. */
const isCurrent = (p: { startDate: string | Date; endDate: string | Date }) =>
  new Date(p.startDate).getTime() <= Date.now() && Date.now() < new Date(p.endDate).getTime();

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

type Span = { key: string; rep: PayPeriodOption; startDate: string | Date; endDate: string | Date; people: number };

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
        people: [...perGroup.values()].reduce((n, v) => n + v, 0),
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key) || b.people - a.people);
}

/** "Sep 13 to Sep 26, 2026 · Current · 841 people", for one option. */
function optionText(p: { startDate: string | Date; endDate: string | Date; status?: string; people?: number }): string {
  // The end is stored as the day after the last day worked.
  const last = new Date(new Date(p.endDate).getTime() - 86400000);
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

/** The range to open on: every pay group, over the current pay period's dates. */
export function defaultPayPeriodRange(payPeriods: PayPeriodOption[]): DateRange | null {
  const pp = currentPayPeriod(payPeriods);
  return pp ? { type: "payPeriod", payPeriodId: pp.id, allGroups: true } : null;
}

export function DateRangePicker({
  value,
  onChange,
  payPeriods,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  payPeriods: PayPeriodOption[];
}) {
  const current = currentPayPeriod(payPeriods);

  function pickKind(kind: string) {
    if (kind === "payPeriod" && current) {
      onChange({ type: "payPeriod", payPeriodId: current.id, allGroups: true });
    } else if (kind === "custom") {
      onChange({ type: "custom", startDate: "", endDate: "" });
    } else {
      onChange({ type: "relative", relativeDays: 14 });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        items={payPeriods.length ? RANGE_KINDS : RANGE_KINDS.filter((k) => k.value !== "payPeriod")}
        value={value.type}
        onChange={pickKind}
        ariaLabel="How to pick the dates"
      />

      {value.type === "payPeriod" && (
        <PayPeriodFields value={value} onChange={onChange} payPeriods={payPeriods} />
      )}

      {value.type === "custom" && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,46%)),1fr))] sm:max-w-[420px]">
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

      {value.type === "relative" && (
        <SegmentedControl
          items={RELATIVE_DAYS.map((d) => ({ value: String(d), label: `${d} days` }))}
          value={String(value.relativeDays)}
          onChange={(v) => onChange({ type: "relative", relativeDays: Number(v) })}
          ariaLabel="How many days back"
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
}: {
  value: Extract<DateRange, { type: "payPeriod" }>;
  onChange: (range: DateRange) => void;
  payPeriods: PayPeriodOption[];
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
      <div className="flex flex-wrap items-center gap-2">
        <Select value={group} onChange={(e) => pickGroup(e.target.value)} aria-label="Pay group" style={{ flex: "0 1 260px" }}>
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
          style={{ flex: "1 1 320px", maxWidth: 400 }}
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
