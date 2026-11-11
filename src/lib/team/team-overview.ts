import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { directReportsOf } from "@/lib/get-subordinate-ids";
import { personTimeZone } from "@/lib/utils/person-time-zone";

/**
 * What Team Overview puts on screen that the dashboard does not already have.
 *
 * <p>Scoped the way every Team page is: a supervisor sees their own direct
 * reports, payroll and HR see the tenant. The scope goes in the where clause
 * of every query, including the tenant, which the previous version of this
 * page left out of its payroll counts.
 *
 * <p>Counts and short lists only. Every number here links to the page that
 * owns it, and each is counted exactly as that page counts it, so the two can
 * never disagree.
 */

export interface TeamQueues {
  exceptions: number;
  leavePending: number;
  leaveWithHr: number;
  upcomingLeave: number;
}

export interface ExceptionTypeCount {
  type: string;
  count: number;
}

export interface TimeOffRow {
  id: string;
  name: string;
  department: string | null;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  durationMinutes: number;
}

type Scope = Prisma.EmployeeWhereInput;

function scopeOf(tenantId: string, employeeId: string | null, isPayroll: boolean): Scope {
  return isPayroll ? { tenantId } : { tenantId, ...directReportsOf(employeeId ?? "") };
}

/** Today as the @db.Date columns store it: UTC midnight. */
function utcToday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getTeamQueues(
  tenantId: string,
  employeeId: string | null,
  isPayroll: boolean,
  now: Date,
): Promise<TeamQueues> {
  const employee = scopeOf(tenantId, employeeId, isPayroll);
  const today = utcToday(now);

  const [exceptions, leavePending, leaveWithHr, upcomingLeave] = await Promise.all([
    db.exception.count({ where: { resolvedAt: null, timesheet: { employee } } }),
    db.leaveRequest.count({ where: { status: "PENDING", employee } }),
    db.leaveRequest.count({ where: { status: "PENDING_HR", employee } }),
    db.leaveRequest.count({
      where: { status: { in: ["APPROVED", "POSTED"] }, endDate: { gte: today }, employee },
    }),
  ]);

  return { exceptions, leavePending, leaveWithHr, upcomingLeave };
}

/**
 * Missed punch requests waiting on a decision: a punch the employee reported
 * (manual, not yet approved or rejected, not a correction) with an open
 * Missing Punch on the same sheet and the same day on their own clock. That
 * is how the Exceptions card pairs a request with its exception and offers
 * Approve and Reject, so the count is what that list shows. Pending requests
 * are few (one on live, Nov 10), so the day is matched here on a bounded set.
 */
export async function countMissedPunchRequests(
  tenantId: string,
  employeeId: string | null,
  isPayroll: boolean,
): Promise<number> {
  const asks = await db.punch.findMany({
    where: {
      source: "MANUAL",
      isApproved: false,
      isRejected: false,
      correctedById: null,
      correctsId: null,
      approvedById: null,
      timesheet: {
        employee: scopeOf(tenantId, employeeId, isPayroll),
        exceptions: { some: { exceptionType: "MISSING_PUNCH", resolvedAt: null } },
      },
    },
    take: 500,
    select: {
      punchTime: true,
      timesheet: {
        select: {
          employee: { select: { timeZone: true, site: { select: { timezone: true } } } },
          exceptions: {
            where: { exceptionType: "MISSING_PUNCH", resolvedAt: null },
            select: { occurredAt: true },
          },
        },
      },
    },
  });
  return asks.filter((a) => {
    const zone = personTimeZone(a.timesheet!.employee);
    const day = dayIn(a.punchTime, zone);
    return a.timesheet!.exceptions.some((e) => dayIn(e.occurredAt, zone) === day);
  }).length;
}

/** The calendar day an instant falls on in a zone, as YYYY-MM-DD. */
function dayIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(instant);
}

/** Open exceptions per type, largest first. Counted in SQL, not in a loop. */
export async function getExceptionTypes(
  tenantId: string,
  employeeId: string | null,
  isPayroll: boolean,
): Promise<ExceptionTypeCount[]> {
  const rows = await db.exception.groupBy({
    by: ["exceptionType"],
    where: { resolvedAt: null, timesheet: { employee: scopeOf(tenantId, employeeId, isPayroll) } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ type: r.exceptionType as string, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Approved time off that touches the next 14 days, soonest first, with the
 * total so the card can say how many it is not showing.
 */
export async function getTimeOffAhead(
  tenantId: string,
  employeeId: string | null,
  isPayroll: boolean,
  now: Date,
  limit = 6,
): Promise<{ rows: TimeOffRow[]; total: number; offToday: number }> {
  const employee = scopeOf(tenantId, employeeId, isPayroll);
  const today = utcToday(now);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + 14);

  const where = {
    status: { in: ["APPROVED" as const, "POSTED" as const] },
    startDate: { lte: horizon },
    endDate: { gte: today },
    employee,
  };

  const [rows, total, offToday] = await Promise.all([
    db.leaveRequest.findMany({
      where,
      orderBy: [{ startDate: "asc" }, { endDate: "asc" }],
      take: limit,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        durationMinutes: true,
        leaveType: { select: { name: true } },
        employee: {
          select: {
            employeeCode: true,
            user: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
    }),
    db.leaveRequest.count({ where }),
    db.leaveRequest.count({
      where: { ...where, startDate: { lte: today }, endDate: { gte: today } },
    }),
  ]);

  return {
    total,
    offToday,
    rows: rows.map((r) => ({
      id: r.id,
      name: r.employee.user?.name?.trim() || `Employee ${r.employee.employeeCode}`,
      department: r.employee.department?.name ?? null,
      leaveType: r.leaveType.name,
      startDate: r.startDate,
      endDate: r.endDate,
      durationMinutes: r.durationMinutes,
    })),
  };
}
