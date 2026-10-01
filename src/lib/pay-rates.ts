import { db } from "@/lib/db";

/** Today as a calendar day in the company's Eastern time, YYYY-MM-DD. */
export function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** A @db.Date column's calendar day, YYYY-MM-DD. */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The Rate 1 in effect on a day: the latest row effective on or before it. */
export function rateInEffect<T extends { effectiveDate: Date; rate1: unknown }>(rows: T[], day: string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (dateKey(r.effectiveDate) > day) continue;
    if (!best || r.effectiveDate > best.effectiveDate) best = r;
  }
  return best;
}

/**
 * Sets employees.payRate to the Rate 1 in effect today, so everything that
 * reads the single rate follows the history. Runs after a save, and nightly so
 * a future-dated rate takes over on its day. Returns how many changed.
 */
export async function syncCurrentPayRates(employeeIds?: string[]): Promise<number> {
  const today = todayKey();
  const rows = await db.employeePayRate.findMany({
    where: employeeIds ? { employeeId: { in: employeeIds } } : {},
    select: { employeeId: true, effectiveDate: true, rate1: true },
  });
  const byEmployee = new Map<string, typeof rows>();
  for (const r of rows) byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r]);

  const targets = employeeIds ?? [...byEmployee.keys()];
  const current = await db.employee.findMany({ where: { id: { in: targets } }, select: { id: true, payRate: true } });

  let changed = 0;
  for (const e of current) {
    const inEffect = rateInEffect(byEmployee.get(e.id) ?? [], today);
    // No history yet (or only future rates): leave the rate as it is.
    if (!inEffect) continue;
    if (e.payRate === null || !e.payRate.equals(inEffect.rate1 as never)) {
      await db.employee.update({ where: { id: e.id }, data: { payRate: inEffect.rate1 } });
      changed++;
    }
  }
  return changed;
}
