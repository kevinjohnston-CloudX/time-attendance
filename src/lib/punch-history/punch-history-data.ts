import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { endOfDayInTz, snapToLocalTime } from "@/lib/utils/date";

/**
 * Everything the Team Punch History screen and its export read, in one place,
 * so the two can never disagree about whose punches a person may see.
 *
 * <p>Who sees whom. Anyone holding PAY_PERIOD_MANAGE sees every active
 * employee in their company, and gets the site and department filters. Anyone
 * else with PUNCH_VIEW_TEAM sees the people who report to them, and nothing
 * else. That rule is the `where` of every query below, including the one that
 * resolves the employee named in the URL: an id from the address bar is never
 * trusted to already be in scope. It was, before this file existed, and any
 * supervisor could read anyone's punches by editing the link.
 *
 * <p>Dates are the site's dates. Punches are stored as instants, and a day
 * boundary drawn in the server's own zone is wrong on a server that runs UTC,
 * which is every deployed one: the evening's clock out lands on tomorrow and
 * the range quietly misses it. The selected person's site decides the zone;
 * with nobody selected, the company's first site does.
 */

/** Longest employee list sent to the browser. Beyond it the search narrows. */
export const EMPLOYEE_LIST_CAP = 200;

const FALLBACK_TZ = "America/New_York";

export type PunchHistoryParams = {
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  siteId?: string;
  departmentId?: string;
  q?: string;
};

type Viewer = {
  role: string;
  customRoleId?: string | null;
  canViewAs?: boolean;
  employeeId?: string | null;
  tenantId?: string | null;
};

export type PayPeriodPreset = {
  startDate: string;
  endDate: string;
  /** Null when rule sets sharing these dates disagree about the status. */
  status: "OPEN" | "READY" | "LOCKED" | null;
  isCurrent: boolean;
};

export type PunchHistoryEmployee = {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
  /** An open missing punch exception on a day inside the range. */
  hasMissingPunch: boolean;
};

export type PunchHistoryPunch = {
  id: string;
  punchType: string;
  punchTime: string;
  roundedTime: string;
  /** The site's calendar date of the rounded time, "yyyy-MM-dd". */
  localDate: string;
  source: string;
  isApproved: boolean;
  isSuperseded: boolean;
  isCorrection: boolean;
};

export type PunchHistoryDay = {
  date: string;
  /** Paid time on the clock for the day, from the pay engine's segments. */
  workedMinutes: number;
  hasMissingPunch: boolean;
  /** Today, with a clock in and no clock out after it. */
  isClockedIn: boolean;
};

export type PunchHistoryData = {
  isPayroll: boolean;
  /** The Exceptions screen checks this, so the link to it does too. */
  canResolveExceptions: boolean;
  startDate: string;
  endDate: string;
  isCustomRange: boolean;
  timezone: string;
  today: string;
  payPeriods: PayPeriodPreset[];
  sites: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  selectedSiteId: string | null;
  selectedDepartmentId: string | null;
  search: string;
  employees: PunchHistoryEmployee[];
  /** Everyone the filters and search match, before the list cap. */
  employeeTotal: number;
  /** Everyone in scope under the site and department filters, ignoring search. */
  scopedTotal: number;
  selected: {
    id: string;
    name: string;
    employeeCode: string;
    department: string;
    site: string | null;
  } | null;
  punches: PunchHistoryPunch[];
  days: PunchHistoryDay[];
  totals: { workedMinutes: number; punches: number; pending: number };
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function localDateOf(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(instant);
}

export async function loadTeamPunchHistory(
  viewer: Viewer,
  params: PunchHistoryParams,
): Promise<PunchHistoryData> {
  const tenantId = viewer.tenantId ?? undefined;
  const [isPayroll, canResolveExceptions] = await Promise.all([
    userHasPermission(viewer, "PAY_PERIOD_MANAGE"),
    userHasPermission(viewer, "TIMESHEET_APPROVE_TEAM"),
  ]);

  // A supervisor with no employee record of their own reports to nobody and
  // has nobody reporting to them. Scoping by an undefined supervisorId would
  // drop the condition and hand them the whole company.
  const scope: Prisma.EmployeeWhereInput = isPayroll
    ? { isActive: true, ...(tenantId ? { tenantId } : {}) }
    : { isActive: true, supervisorId: viewer.employeeId ?? "__none__", ...(tenantId ? { tenantId } : {}) };

  const selectedSiteId = isPayroll ? (params.siteId || null) : null;
  const selectedDepartmentId = isPayroll ? (params.departmentId || null) : null;
  const filtered: Prisma.EmployeeWhereInput = {
    ...scope,
    ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
    ...(selectedDepartmentId ? { departmentId: selectedDepartmentId } : {}),
  };

  const search = (params.q ?? "").trim().slice(0, 80);
  const matching: Prisma.EmployeeWhereInput = search
    ? {
        ...filtered,
        OR: [
          { user: { name: { contains: search, mode: "insensitive" } } },
          { employeeCode: { contains: search, mode: "insensitive" } },
          { department: { name: { contains: search, mode: "insensitive" } } },
        ],
      }
    : filtered;

  const employeeSelect = {
    id: true,
    employeeCode: true,
    user: { select: { name: true } },
    department: { select: { name: true } },
    site: { select: { name: true, timezone: true } },
  } satisfies Prisma.EmployeeSelect;

  const [sites, departments, list, employeeTotal, scopedTotal, firstSite] = await Promise.all([
    isPayroll
      ? db.site.findMany({
          where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    isPayroll
      ? db.department.findMany({
          where: {
            isActive: true,
            ...(tenantId ? { tenantId } : {}),
            ...(selectedSiteId ? { sites: { some: { siteId: selectedSiteId } } } : {}),
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    db.employee.findMany({
      where: matching,
      select: employeeSelect,
      orderBy: { user: { name: "asc" } },
      take: EMPLOYEE_LIST_CAP,
    }),
    db.employee.count({ where: matching }),
    search ? db.employee.count({ where: filtered }) : Promise.resolve(-1),
    db.site.findFirst({
      where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
      orderBy: { name: "asc" },
      select: { timezone: true },
    }),
  ]);

  // The person being looked at: the one the URL names, if and only if they are
  // inside this viewer's scope and the site and department filters, else the
  // first match. Search does not unselect anyone, the same as in the design:
  // narrowing the list to find the next person should not blank the record
  // you are still reading.
  const named = params.employeeId
    ? await db.employee.findFirst({ where: { ...filtered, id: params.employeeId }, select: employeeSelect })
    : null;
  const selectedRow = params.employeeId ? named : (list[0] ?? null);

  const timezone = selectedRow?.site?.timezone ?? firstSite?.timezone ?? FALLBACK_TZ;
  const today = localDateOf(new Date(), timezone);

  // Pay periods for the picker: the three most recent that have started, with
  // any duplicates from rule sets that share dates folded into one.
  const periodRows = await db.payPeriod.findMany({
    where: { ...(tenantId ? { tenantId } : {}), startDate: { lte: new Date() } },
    orderBy: { startDate: "desc" },
    take: 12,
    select: { startDate: true, endDate: true, status: true },
  });
  const byRange = new Map<string, PayPeriodPreset>();
  for (const p of periodRows) {
    const startDate = localDateOf(p.startDate, timezone);
    const endDate = localDateOf(p.endDate, timezone);
    const key = `${startDate}|${endDate}`;
    const seen = byRange.get(key);
    if (seen) {
      if (seen.status !== p.status) seen.status = null;
    } else if (byRange.size < 3) {
      byRange.set(key, { startDate, endDate, status: p.status, isCurrent: startDate <= today && today <= endDate });
    }
  }
  const payPeriods = [...byRange.values()];
  const current = payPeriods.find((p) => p.isCurrent) ?? null;

  const isCustomRange =
    !!params.startDate && !!params.endDate && ISO_DATE.test(params.startDate) && ISO_DATE.test(params.endDate);
  let startDate: string;
  let endDate: string;
  if (isCustomRange) {
    [startDate, endDate] =
      params.startDate! <= params.endDate! ? [params.startDate!, params.endDate!] : [params.endDate!, params.startDate!];
  } else if (current) {
    ({ startDate, endDate } = current);
  } else {
    const twoWeeksAgo = new Date(Date.now() - 13 * 86_400_000);
    startDate = localDateOf(twoWeeksAgo, timezone);
    endDate = today;
  }
  const rangeStart = snapToLocalTime("00:00", startDate, timezone);
  const rangeEnd = endOfDayInTz(endDate, timezone);

  // Open missing punch exceptions in range, for the list's flags and the
  // day headers. The engine files them at noon UTC on the site's date, so the
  // date is read straight off the instant.
  const listIds = list.map((e) => e.id);
  const flagIds = selectedRow && !listIds.includes(selectedRow.id) ? [...listIds, selectedRow.id] : listIds;
  const missing = flagIds.length
    ? await db.exception.findMany({
        where: {
          exceptionType: "MISSING_PUNCH",
          resolvedAt: null,
          occurredAt: { gte: new Date(`${startDate}T00:00:00.000Z`), lte: new Date(`${endDate}T23:59:59.999Z`) },
          timesheet: { employeeId: { in: flagIds } },
        },
        select: { occurredAt: true, timesheet: { select: { employeeId: true } } },
      })
    : [];
  const flagged = new Set(missing.map((m) => m.timesheet.employeeId));

  const toEmployee = (e: (typeof list)[number]) => ({
    id: e.id,
    name: e.user?.name ?? e.employeeCode,
    employeeCode: e.employeeCode,
    department: e.department?.name ?? "No department",
  });

  let punches: PunchHistoryPunch[] = [];
  let days: PunchHistoryDay[] = [];
  if (selectedRow) {
    const [rows, segments] = await Promise.all([
      db.punch.findMany({
        where: { employeeId: selectedRow.id, isRejected: false, roundedTime: { gte: rangeStart, lte: rangeEnd } },
        orderBy: [{ roundedTime: "asc" }, { punchTime: "asc" }],
        select: {
          id: true,
          punchType: true,
          punchTime: true,
          roundedTime: true,
          source: true,
          isApproved: true,
          correctedById: true,
          correctsId: true,
        },
      }),
      // Summed in SQL, per day. Paid work and paid breaks: the time the pay
      // engine credits for being on the clock, after rounding and meal rules,
      // and without leave or holiday credit, which are not punches.
      db.workSegment.groupBy({
        by: ["segmentDate"],
        where: {
          timesheet: { employeeId: selectedRow.id },
          segmentType: { in: ["WORK", "BREAK"] },
          isPaid: true,
          segmentDate: { gte: new Date(`${startDate}T00:00:00.000Z`), lte: new Date(`${endDate}T00:00:00.000Z`) },
        },
        _sum: { durationMinutes: true },
      }),
    ]);

    punches = rows.map((p) => ({
      id: p.id,
      punchType: p.punchType,
      punchTime: p.punchTime.toISOString(),
      roundedTime: p.roundedTime.toISOString(),
      localDate: localDateOf(p.roundedTime, timezone),
      source: p.source,
      isApproved: p.isApproved,
      isSuperseded: !!p.correctedById,
      isCorrection: !!p.correctsId,
    }));

    const worked = new Map(
      segments.map((s) => [s.segmentDate.toISOString().slice(0, 10), s._sum.durationMinutes ?? 0]),
    );
    const missingDays = new Set(
      missing.filter((m) => m.timesheet.employeeId === selectedRow.id).map((m) => m.occurredAt.toISOString().slice(0, 10)),
    );
    const dates = [...new Set(punches.map((p) => p.localDate))];
    days = dates.map((date) => {
      const live = punches.filter((p) => p.localDate === date && !p.isSuperseded);
      const lastIn = live.findLast((p) => p.punchType === "CLOCK_IN");
      const outAfter = lastIn && live.some((p) => p.punchType === "CLOCK_OUT" && p.roundedTime >= lastIn.roundedTime);
      return {
        date,
        workedMinutes: worked.get(date) ?? 0,
        hasMissingPunch: missingDays.has(date),
        isClockedIn: date === today && !!lastIn && !outAfter,
      };
    });
  }

  const live = punches.filter((p) => !p.isSuperseded);
  return {
    isPayroll,
    canResolveExceptions,
    startDate,
    endDate,
    isCustomRange,
    timezone,
    today,
    payPeriods,
    sites,
    departments,
    selectedSiteId,
    selectedDepartmentId,
    search,
    employees: list.map((e) => ({ ...toEmployee(e), hasMissingPunch: flagged.has(e.id) })),
    employeeTotal,
    scopedTotal: scopedTotal < 0 ? employeeTotal : scopedTotal,
    selected: selectedRow ? { ...toEmployee(selectedRow), site: selectedRow.site?.name ?? null } : null,
    punches,
    days,
    totals: {
      workedMinutes: days.reduce((n, d) => n + d.workedMinutes, 0),
      punches: punches.length,
      pending: live.filter((p) => !p.isApproved).length,
    },
  };
}
