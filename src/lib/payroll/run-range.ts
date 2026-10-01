import type { RunPeriod } from "@/actions/payroll-run.actions";

/** "2026-09-13" as "Sep 13, 2026", read as a calendar day (no time zone shift). */
export function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The pay periods a run would take in, grouped by their dates: every period
 * of the frequency lying wholly inside From and To. Mirrors the server's
 * periodsInRange, so the page can say what is included before Preview.
 */
export function includedDates(periods: RunPeriod[], frequency: string, from: string, to: string) {
  const groups = new Map<string, { startDay: string; lastDay: string; names: string[]; locked: number; timecards: number }>();
  if (!from || !to || from > to) return [];
  for (const p of periods) {
    if (p.frequency !== frequency || p.startDay < from || p.lastDay > to) continue;
    const key = `${p.startDay}|${p.lastDay}`;
    const g = groups.get(key) ?? { startDay: p.startDay, lastDay: p.lastDay, names: [], locked: 0, timecards: 0 };
    g.names.push(p.name);
    if (p.status === "LOCKED") g.locked++;
    g.timecards += p.timecards;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.startDay.localeCompare(b.startDay));
}
