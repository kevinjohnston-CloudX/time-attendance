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
const isCurrent = (p: PayPeriodOption) =>
  new Date(p.startDate).getTime() <= Date.now() && Date.now() < new Date(p.endDate).getTime();

/** Pay periods under their pay group, groups with people in them first. */
function byGroup(payPeriods: PayPeriodOption[]): { name: string; periods: PayPeriodOption[]; people: number }[] {
  const map = new Map<string, PayPeriodOption[]>();
  for (const p of payPeriods) {
    const key = p.groupName ?? "No pay group";
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return [...map.entries()]
    .map(([name, periods]) => ({ name, periods, people: Math.max(0, ...periods.map((p) => p.people ?? 0)) }))
    .sort((a, b) => Number(b.people > 0) - Number(a.people > 0) || a.name.localeCompare(b.name));
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
      onChange({ type: "payPeriod", payPeriodId: current.id });
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
        <div className="flex flex-col gap-1.5">
          <Select
            value={value.payPeriodId}
            onChange={(e) => onChange({ type: "payPeriod", payPeriodId: e.target.value })}
            aria-label="Pay period"
            style={{ maxWidth: 420 }}
          >
            {byGroup(payPeriods).map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.periods.map((pp) => {
                  // The end is stored as the day after the last day worked.
                  const last = new Date(new Date(pp.endDate).getTime() - 86400000);
                  const tag = isCurrent(pp)
                    ? "Current"
                    : new Date(pp.startDate).getTime() > Date.now()
                      ? "Upcoming"
                      : STATUS_WORD[pp.status] ?? pp.status;
                  const who =
                    pp.people === undefined ? "" : pp.people === 0 ? " · No one" : ` · ${pp.people} ${pp.people === 1 ? "person" : "people"}`;
                  return (
                    <option key={pp.id} value={pp.id}>
                      {day(pp.startDate, false)} to {day(last, true)} · {tag}
                      {who}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </Select>
          <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
            A pay period covers one pay group. To include every group, use Pick dates.
          </span>
        </div>
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
