import { Prisma, ExceptionType } from "@prisma/client";
import type { PayFrequency, PunchType } from "@prisma/client";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { scheduledWindow } from "@/lib/utils/shift-schedule";

/**
 * The open exceptions the Exceptions screen and its export read, already
 * scoped by the caller (getTeamExceptions checks the permission and works out
 * whose they are first). Kept out of the actions file on purpose: everything a
 * "use server" file exports can be called straight from a browser, and this
 * has no permission check of its own.
 */

/** A day (YYYY-MM-DD) as the pay period start dates store it. */
export function dayRange(day: string) {
  return { gte: new Date(`${day}T00:00:00.000Z`), lt: new Date(`${day}T23:59:59.999Z`) };
}

export async function readOpenExceptions({
  t,
  idFilter,
  siteId,
  departmentId,
  shiftId,
  exceptionType,
  payPeriodStart,
}: {
  /** The tenant, or undefined to read every tenant (as the Prisma filter did). */
  t: string | undefined;
  idFilter: { id?: { in: string[] } };
  siteId?: string;
  departmentId?: string;
  shiftId?: string;
  exceptionType?: ExceptionType;
  payPeriodStart?: string;
}) {
  /**
   * The open exceptions, with who, where and which pay period, in one query.
   *
   * <p>The same rows and the same shape the nested Prisma read returned
   * (checked field by field against it), but as one statement: Prisma
   * fetched each level of the nesting as its own round trip, four in a row
   * over a thousand ids each, which was most of this page's wait. Ordered by
   * time as before, with the id breaking ties so the order is the same every
   * time.
   */
  const where: Prisma.Sql[] = [
    Prisma.sql`ex."resolvedAt" IS NULL`,
    Prisma.sql`ex."exceptionType"::text IN (${Prisma.join(Object.values(ExceptionType))})`,
  ];
  if (exceptionType) where.push(Prisma.sql`ex."exceptionType"::text = ${exceptionType}`);
  if (payPeriodStart) {
    const range = dayRange(payPeriodStart);
    where.push(Prisma.sql`pp."startDate" >= ${range.gte} AND pp."startDate" < ${range.lt}`);
  }
  if (t) where.push(Prisma.sql`emp."tenantId" = ${t}`);
  if (idFilter.id) where.push(Prisma.sql`emp.id IN (${Prisma.join(idFilter.id.in)})`);
  if (siteId) where.push(Prisma.sql`emp."siteId" = ${siteId}`);
  if (departmentId) where.push(Prisma.sql`emp."departmentId" = ${departmentId}`);
  if (shiftId) where.push(Prisma.sql`emp."shiftId" = ${shiftId}`);

  const flat = await db.$queryRaw<
    {
      id: string;
      exceptionType: ExceptionType;
      description: string;
      occurredAt: Date;
      timesheetId: string;
      employeeId: string;
      shiftId: string | null;
      userName: string | null;
      siteName: string;
      departmentName: string;
      payPeriodId: string;
      startDate: Date;
      endDate: Date;
      ruleSetId: string | null;
      ruleSetFrequency: string | null;
      tenantFrequency: string;
      hasPunches: boolean;
    }[]
  >`
    SELECT ex.id, ex."exceptionType"::text AS "exceptionType", ex.description, ex."occurredAt", ex."timesheetId",
           ts."employeeId", emp."shiftId", u.name AS "userName", s.name AS "siteName", d.name AS "departmentName",
           pp.id AS "payPeriodId", pp."startDate", pp."endDate",
           rs.id AS "ruleSetId", rs."payFrequency"::text AS "ruleSetFrequency", tn."payFrequency"::text AS "tenantFrequency",
           EXISTS (
             SELECT 1 FROM "punches" p
             WHERE p."timesheetId" = ts.id AND p."isApproved" AND p."correctedById" IS NULL
           ) AS "hasPunches"
    FROM   "exceptions" ex
    JOIN   "timesheets"  ts  ON ts.id  = ex."timesheetId"
    JOIN   "employees"   emp ON emp.id = ts."employeeId"
    JOIN   "users"       u   ON u.id   = emp."userId"
    JOIN   "sites"       s   ON s.id   = emp."siteId"
    JOIN   "departments" d   ON d.id   = emp."departmentId"
    JOIN   "pay_periods" pp  ON pp.id  = ts."payPeriodId"
    LEFT JOIN "rule_sets" rs ON rs.id  = pp."ruleSetId"
    JOIN   "tenants"     tn  ON tn.id  = pp."tenantId"
    WHERE  ${Prisma.join(where, " AND ")}
    ORDER  BY ex."occurredAt" ASC, ex.id ASC
  `;
  const rows = flat.map((r) => ({
    id: r.id,
    exceptionType: r.exceptionType,
    description: r.description,
    occurredAt: r.occurredAt,
    timesheetId: r.timesheetId,
    timesheet: {
      employeeId: r.employeeId,
      employee: {
        shiftId: r.shiftId,
        user: { name: r.userName },
        site: { name: r.siteName },
        department: { name: r.departmentName },
      },
      payPeriod: {
        id: r.payPeriodId,
        startDate: r.startDate,
        endDate: r.endDate,
        ruleSet: r.ruleSetId ? { payFrequency: r.ruleSetFrequency as PayFrequency | null } : null,
        tenant: { payFrequency: r.tenantFrequency as PayFrequency },
      },
      _count: { punches: r.hasPunches ? 1 : 0 },
    },
  }));

  /**
   * What the day was scheduled as, and what was actually recorded on it.
   *
   * <p>Two more queries rather than two more includes, and that is the whole
   * point. Including the punches is what made this page 25MB: roughly three
   * exceptions share a timesheet, so every punch on that sheet was
   * serialised three times over. Here the punch read is narrowed to clock in
   * and clock out, to the sheets already in the result, to the days those
   * exceptions fell on, and to three columns, and nothing but two short
   * strings per card ever reaches the browser.
   *
   * <p>The days are bucketed with the same format() the action panel uses
   * rather than by grouping on rounded_time::date in Postgres. The database
   * would do the arithmetic in one query fewer and would put a night shift's
   * clock out on the following day, because the column is stored in UTC.
   */
  const timesheetIds = Array.from(new Set(rows.map((r) => r.timesheetId)));
  const recorded = new Map<string, { in: string | null; out: string | null }>();

  if (timesheetIds.length > 0) {
    /*
     * Only the punches on a day some exception here fell on, for that
     * exception's sheet: the only ones the lookup below ever reads. It used
     * to take every clock in and out on these sheets across the whole span
     * of the list, three months of them, and throw most away. The day is
     * the same one format() gives below, in the zone this process runs in,
     * so a punch matches exactly when it used to.
     */
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const keys = Array.from(new Set(rows.map((r) => `${r.timesheetId}|${format(r.occurredAt, "yyyy-MM-dd")}`)));
    const keySheets = keys.map((k) => k.slice(0, k.indexOf("|")));
    const keyDays = keys.map((k) => k.slice(k.indexOf("|") + 1));

    const punches = await db.$queryRaw<{ timesheetId: string | null; punchType: PunchType; roundedTime: Date }[]>`
      SELECT p."timesheetId", p."punchType"::text AS "punchType", p."roundedTime"
      FROM   "punches" p
      JOIN   unnest(${keySheets}::text[], ${keyDays}::date[]) AS k(sheet, day)
             ON  p."timesheetId" = k.sheet
             AND ((p."roundedTime" AT TIME ZONE 'UTC') AT TIME ZONE ${zone})::date = k.day
      WHERE  p."punchType"::text IN ('CLOCK_IN', 'CLOCK_OUT')
        AND  p."isApproved"
        AND  p."correctedById" IS NULL
      ORDER  BY p."roundedTime" ASC
    `;

    for (const p of punches) {
      if (!p.timesheetId) continue;
      const key = `${p.timesheetId}|${format(p.roundedTime, "yyyy-MM-dd")}`;
      const entry = recorded.get(key) ?? { in: null, out: null };
      // Read in time order, so the first clock in and the last clock out of
      // the day win. A split shift shows the outer edges of it, which is
      // what the exception was raised against.
      if (p.punchType === "CLOCK_IN") entry.in = entry.in ?? format(p.roundedTime, "HH:mm");
      else entry.out = format(p.roundedTime, "HH:mm");
      recorded.set(key, entry);
    }
  }

  const shiftIds = Array.from(
    new Set(rows.map((r) => r.timesheet.employee.shiftId).filter((id): id is string => !!id)),
  );
  const shifts = shiftIds.length
    ? await db.shift.findMany({
        // Scoped by the employees already in scope rather than by tenant
        // again: these ids came off rows this caller is allowed to read.
        where: { id: { in: shiftIds } },
        select: { id: true, startTime: true, endTime: true, daySchedule: true },
      })
    : [];
  const shiftById = new Map(shifts.map((sh) => [sh.id, sh]));

  return rows.map(({ timesheet, ...ex }) => ({
    ...ex,
    scheduled: scheduledWindow(
      timesheet.employee.shiftId ? shiftById.get(timesheet.employee.shiftId) : null,
      ex.occurredAt,
    ),
    recorded:
      recorded.get(`${ex.timesheetId}|${format(ex.occurredAt, "yyyy-MM-dd")}`) ??
      { in: null, out: null },
    timesheet: {
      employeeId: timesheet.employeeId,
      employee:   timesheet.employee,
      payPeriod:  timesheet.payPeriod,
      hasPunches: timesheet._count.punches > 0,
    },
  }));
}
