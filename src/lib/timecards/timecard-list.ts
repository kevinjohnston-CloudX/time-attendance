import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { periodDayRange } from "@/lib/pay-period-days";
import { startedOn } from "@/lib/engines/segment-builder";

const nextDayKey = (k: string, n = 1) => new Date(Date.parse(k + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The people the timecard list offers, with each one's timecard status and
 * open exceptions for the days on screen.
 *
 * <p>The days on screen are the picked pay period's, or today when none is
 * picked. Each person's own timecards for those days are read, whichever pay
 * group they are in: every group has its own pay periods, so matching on the
 * picked period's id found the selected person's group alone, and with no
 * period picked it read a company period nobody's timecards are in, so no
 * exceptions showed and the Exceptions filter found no one. A person is
 * Locked when every timecard of theirs in those days is.
 *
 * <p>Active people are always listed. Inactive people are listed when they
 * have a timecard in those days (a last paycheck, a timecard still open), for
 * the "Active employees only" filter to bring back; before, the list held
 * active people only, so that filter did nothing.
 */
export async function timecardList(scope: Prisma.EmployeeWhereInput, tenantId: string | null | undefined, payPeriodId: string | null) {
  let days: { firstDay: string; lastDay: string } | null = null;
  if (payPeriodId) {
    const period = await db.payPeriod.findFirst({
      where: { id: payPeriodId, ...(tenantId ? { tenantId } : {}) },
      select: { startDate: true, endDate: true, ruleSet: { select: { payFrequency: true } }, tenant: { select: { payFrequency: true } } },
    });
    if (period) days = periodDayRange(period, period.ruleSet?.payFrequency ?? period.tenant.payFrequency);
  }
  if (!days) {
    const today = new Date().toISOString().slice(0, 10);
    days = { firstDay: today, lastDay: today };
  }
  const { firstDay, lastDay } = days;

  // Loosely by stored dates (a month either side covers every frequency and
  // every way the dates were stored), then exactly by calendar days.
  const timesheets = (
    await db.timesheet.findMany({
      where: {
        employee: scope,
        payPeriod: {
          startDate: { lte: new Date(nextDayKey(lastDay) + "T23:59:59Z") },
          endDate: { gte: new Date(nextDayKey(firstDay, -35) + "T00:00:00Z") },
        },
      },
      select: {
        employeeId: true,
        status: true,
        employee: { select: { isActive: true } },
        payPeriod: { select: { startDate: true, endDate: true, ruleSet: { select: { payFrequency: true } }, tenant: { select: { payFrequency: true } } } },
        exceptions: { where: { resolvedAt: null }, select: { exceptionType: true } },
      },
    })
  ).filter((ts) => {
    const r = periodDayRange(ts.payPeriod, ts.payPeriod.ruleSet?.payFrequency ?? ts.payPeriod.tenant.payFrequency);
    return r.firstDay <= lastDay && r.lastDay >= firstDay;
  });

  const byEmployee = new Map<string, typeof timesheets>();
  for (const ts of timesheets) byEmployee.set(ts.employeeId, [...(byEmployee.get(ts.employeeId) ?? []), ts]);
  const inactiveWithTimecard = [...new Set(timesheets.filter((ts) => !ts.employee.isActive).map((ts) => ts.employeeId))];

  // `select` rather than `include`: include brings every column on the
  // employee with it, so the picker was carrying pay rates, dates of birth
  // and home addresses for everybody to draw a name and a department.
  const employees = await db.employee.findMany({
    where: { AND: [scope, { OR: [{ isActive: true }, { id: { in: inactiveWithTimecard } }] }] },
    select: {
      id: true,
      employeeCode: true,
      wmsId: true,
      isActive: true,
      payType: true,
      hireDate: true,
      adjustedHireDate: true,
      user: { select: { name: true } },
      department: { select: { name: true } },
      site: { select: { id: true, name: true } },
    },
    orderBy: { user: { name: "asc" } },
  });

  return employees.map((emp) => {
    const cards = byEmployee.get(emp.id) ?? [];
    const locked = cards.length > 0 && cards.every((c) => c.status === "LOCKED" || c.status === "PAYROLL_APPROVED");
    return {
      employeeId: emp.id,
      name: emp.user?.name ?? emp.id,
      employeeCode: emp.employeeCode,
      wmsId: emp.wmsId ?? null,
      department: emp.department.name,
      siteId: emp.site?.id ?? null,
      siteName: emp.site?.name ?? null,
      isActive: emp.isActive,
      payType: emp.payType ?? null,
      startedOn: startedOn(emp),
      status: locked ? "LOCKED" : "OPEN",
      exceptionTypes: [...new Set(cards.flatMap((c) => c.exceptions.map((e) => e.exceptionType)))],
    };
  });
}
