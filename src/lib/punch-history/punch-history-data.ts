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
  /** Punches still waiting on approval, which the pay engine does not count yet. */
  hasPending: boolean;
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

/**
 * A superseded punch goes directly above the correction that replaced it,
 * whatever the two times are, so the pair reads as what was recorded and then
 * what it was changed to. Sorted by time alone, a later original lands under
 * its own correction. The screen and the export both use it.
 */
function pairCorrections<T extends { id: string; correctedById: string | null }>(rows: T[]): T[] {
  const ids = new Set(rows.map((p) => p.id));
  const ordered = rows.filter((p) => !(p.correctedById && ids.has(p.correctedById)));
  for (const original of rows) {
    if (!original.correctedById || !ids.has(original.correctedById)) continue;
    ordered.splice(ordered.findIndex((p) => p.id === original.correctedById), 0, original);
  }
  return ordered;
}

/**
 * Who this viewer may see, narrowed by the filters and the search. Shared by
 * the screen and the export, so the two cannot drift apart on it.
 */
async function resolveScope(viewer: Viewer, params: PunchHistoryParams) {
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

  return { tenantId, isPayroll, canResolveExceptions, selectedSiteId, selectedDepartmentId, filtered, search, matching };
}

/**
 * The date range in force: the one asked for, else the current pay period,
 * else the last fourteen days. Also the recent pay periods for the picker.
 */
async function resolveRange(tenantId: string | undefined, params: PunchHistoryParams, timezone: string) {
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
  return { today, payPeriods, isCustomRange, startDate, endDate };
}

export async function loadTeamPunchHistory(
  viewer: Viewer,
  params: PunchHistoryParams,
): Promise<PunchHistoryData> {
  const { tenantId, isPayroll, canResolveExceptions, selectedSiteId, selectedDepartmentId, filtered, search, matching } =
    await resolveScope(viewer, params);

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

  const { today, payPeriods, isCustomRange, startDate, endDate } = await resolveRange(tenantId, params, timezone);
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

    punches = pairCorrections(rows).map((p) => ({
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
        hasPending: live.some((p) => !p.isApproved),
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

/** Most punch rows one export will write. Past it the export refuses. */
export const EXPORT_ROW_CAP = 50_000;

export type PunchExportRow = {
  employee: string;
  employeeCode: string;
  department: string;
  site: string;
  date: string;
  punchType: string;
  actual: string;
  rounded: string;
  source: string;
  status: "Approved" | "Pending" | "Superseded";
  isCorrection: boolean;
};

export type PunchExport =
  | { ok: true; startDate: string; endDate: string; rows: PunchExportRow[] }
  | { ok: false; reason: "too_many"; count: number };

/**
 * Every punch in the range for everyone the screen's filters and search
 * match, for the spreadsheet. Not capped at the list's 200: a file that
 * quietly leaves people out is worse than no file. Capped instead on rows, and
 * refused past it, so a whole company over a long range cannot tie the server
 * up; the caller says how to narrow it.
 *
 * <p>Each row is on its own employee's site clock, 12 hour.
 */
export async function loadPunchExport(viewer: Viewer, params: PunchHistoryParams): Promise<PunchExport> {
  const { tenantId, matching } = await resolveScope(viewer, params);
  const firstSite = await db.site.findFirst({
    where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
    orderBy: { name: "asc" },
    select: { timezone: true },
  });
  const { startDate, endDate } = await resolveRange(tenantId, params, firstSite?.timezone ?? FALLBACK_TZ);

  // A day either side, because each site draws its own midnight. Rows outside
  // their own site's dates are dropped below.
  const where: Prisma.PunchWhereInput = {
    isRejected: false,
    employee: matching,
    roundedTime: {
      gte: new Date(Date.parse(`${startDate}T00:00:00.000Z`) - 86_400_000),
      lte: new Date(Date.parse(`${endDate}T23:59:59.999Z`) + 86_400_000),
    },
  };
  const count = await db.punch.count({ where });
  if (count > EXPORT_ROW_CAP) return { ok: false, reason: "too_many", count };

  const [punches, people] = await Promise.all([
    db.punch.findMany({
      where,
      orderBy: [{ roundedTime: "asc" }, { punchTime: "asc" }],
      select: {
        id: true,
        employeeId: true,
        punchType: true,
        punchTime: true,
        roundedTime: true,
        source: true,
        isApproved: true,
        correctedById: true,
        correctsId: true,
      },
    }),
    db.employee.findMany({
      where: matching,
      select: {
        id: true,
        employeeCode: true,
        user: { select: { name: true } },
        department: { select: { name: true } },
        site: { select: { name: true, timezone: true } },
      },
    }),
  ]);

  const who = new Map(people.map((e) => [e.id, e]));
  const clocks = new Map<string, { date: Intl.DateTimeFormat; secs: Intl.DateTimeFormat; mins: Intl.DateTimeFormat }>();
  const clockFor = (tz: string) => {
    let c = clocks.get(tz);
    if (!c) {
      c = {
        date: new Intl.DateTimeFormat("en-CA", { timeZone: tz }),
        secs: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }),
        mins: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }),
      };
      clocks.set(tz, c);
    }
    return c;
  };

  const SOURCE: Record<string, string> = { WEB: "Web", KIOSK: "Kiosk", MOBILE: "Mobile", MANUAL: "Manual", SYSTEM: "System" };
  const TYPE: Record<string, string> = {
    CLOCK_IN: "Clock In", CLOCK_OUT: "Clock Out", MEAL_START: "Start Meal",
    MEAL_END: "End Meal", BREAK_START: "Start Break", BREAK_END: "End Break",
  };

  const rows: PunchExportRow[] = [];
  for (const p of pairCorrections(punches)) {
    const e = who.get(p.employeeId);
    if (!e) continue;
    const c = clockFor(e.site?.timezone ?? FALLBACK_TZ);
    const date = c.date.format(p.roundedTime);
    if (date < startDate || date > endDate) continue;
    rows.push({
      employee: e.user?.name ?? e.employeeCode,
      employeeCode: e.employeeCode,
      department: e.department?.name ?? "",
      site: e.site?.name ?? "",
      date,
      punchType: TYPE[p.punchType] ?? p.punchType,
      actual: c.secs.format(p.punchTime),
      rounded: c.mins.format(p.roundedTime),
      source: SOURCE[p.source] ?? p.source,
      status: p.correctedById ? "Superseded" : p.isApproved ? "Approved" : "Pending",
      isCorrection: !!p.correctsId,
    });
  }
  // By person, then in the order they happened, which is how payroll reads it.
  rows.sort((a, b) => a.employee.localeCompare(b.employee) || a.employeeCode.localeCompare(b.employeeCode));
  return { ok: true, startDate, endDate, rows };
}
