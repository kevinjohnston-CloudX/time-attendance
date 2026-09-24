import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { endOfDayInTz, snapToLocalTime } from "@/lib/utils/date";
import { photoUrls } from "@/lib/presence/photos";

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
  /** "attention": only people with a missing or pending punch in the range. */
  show?: string;
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
  /** A signed link to the time clock tablet's photo, or null for initials. */
  photoUrl: string | null;
  /** An open missing punch exception on a day inside the range. */
  hasMissingPunch: boolean;
  /** Punches in the range still waiting on approval. */
  pendingCount: number;
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
  /** Deleted by someone. Still shown, struck through, so the record is complete. */
  isRemoved: boolean;
  /**
   * Who changed this punch by hand, and when: a correction, a punch added on
   * the timecard, or a removal. Null for a punch the clock recorded.
   */
  change: {
    kind: "corrected" | "added" | "removed";
    /** Null when nobody is recorded, as with the system's own corrections. */
    by: string | null;
    at: string | null;
    /** The reason somebody typed. Notes the system wrote itself are left out. */
    reason: string | null;
  } | null;
};

export type PunchHistoryDay = {
  date: string;
  /** Paid time on the clock for the day, from the pay engine's segments. */
  workedMinutes: number;
  /** Unpaid meal time the pay engine took out, punched or deducted automatically. */
  mealMinutes: number;
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
  /** Only people with a missing or pending punch in the range are listed. */
  attentionOnly: boolean;
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
    photoUrl: string | null;
    site: string | null;
  } | null;
  punches: PunchHistoryPunch[];
  days: PunchHistoryDay[];
  totals: {
    workedMinutes: number;
    punches: number;
    pending: number;
    /** Days with a clock in that still stands. */
    daysWorked: number;
    /** Days in the range with an open missing punch exception. */
    missingDays: number;
  };
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
 * A removal is stored as a hidden stand in: a punch that "corrects" the one
 * deleted, never approved, with a note starting VOID. It is not a punch
 * anybody made, so it is never shown or counted; the punch it removed is
 * shown as removed instead.
 */
function isRemovalMarker(p: { correctsId: string | null; isApproved: boolean; note: string | null }): boolean {
  return !!p.correctsId && !p.isApproved && (p.note ?? "").startsWith("VOID");
}

/**
 * Notes the system or a repair wrote for itself rather than a reason a person
 * gave. They explain internals nobody on this screen can act on.
 */
const MACHINE_NOTE = /^(AUTO-CORRECTED|Relabelled|Device:|Removed by payroll$|Manual entry deleted$)/;

function humanReason(note: string | null): string | null {
  const text = (note ?? "").replace(/^VOID:?\s*/, "").trim();
  return text && !MACHINE_NOTE.test(text) ? text : null;
}

/** A punch still waiting on approval, in the range. Removal markers are not punches. */
function pendingPunchWhere(from: Date, to: Date): Prisma.PunchWhereInput {
  return {
    isRejected: false,
    isApproved: false,
    correctedById: null,
    roundedTime: { gte: from, lte: to },
    // A null note must still count, and NOT on a null column matches nothing.
    OR: [{ note: null }, { NOT: { note: { startsWith: "VOID" } } }],
  };
}

/** An open missing punch exception on a date in the range (filed at noon UTC on the site's date). */
function missingExceptionWhere(startDate: string, endDate: string): Prisma.ExceptionWhereInput {
  return {
    exceptionType: "MISSING_PUNCH",
    resolvedAt: null,
    occurredAt: { gte: new Date(`${startDate}T00:00:00.000Z`), lte: new Date(`${endDate}T23:59:59.999Z`) },
  };
}

/** People with something to look at in the range: a missing punch, or one waiting on approval. */
function attentionWhere(startDate: string, endDate: string, from: Date, to: Date): Prisma.EmployeeWhereInput {
  return {
    OR: [
      { timesheets: { some: { exceptions: { some: missingExceptionWhere(startDate, endDate) } } } },
      { punches: { some: pendingPunchWhere(from, to) } },
    ],
  };
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
    // Only to find each person's tablet photo; never sent to the browser.
    barcode: true,
    wmsId: true,
  } satisfies Prisma.EmployeeSelect;

  const attentionOnly = params.show === "attention";

  const [sites, departments, firstSite, named] = await Promise.all([
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
    db.site.findFirst({
      where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
      orderBy: { name: "asc" },
      select: { timezone: true },
    }),
    // The person being looked at: the one the URL names, if and only if they
    // are inside this viewer's scope and the site and department filters.
    // Search and Needs attention do not unselect anyone, the same as in the
    // design: narrowing the list to find the next person should not blank the
    // record you are still reading.
    params.employeeId
      ? db.employee.findFirst({ where: { ...filtered, id: params.employeeId }, select: employeeSelect })
      : Promise.resolve(null),
  ]);

  // The range is needed before the list when the list is narrowed to people
  // with something in it, so it is read on the named person's clock, else the
  // first site's, and read again below if the person opened is on another.
  const listTz = named?.site?.timezone ?? firstSite?.timezone ?? FALLBACK_TZ;
  const listRange = await resolveRange(tenantId, params, listTz);
  const listWhere: Prisma.EmployeeWhereInput = attentionOnly
    ? {
        AND: [
          matching,
          attentionWhere(
            listRange.startDate,
            listRange.endDate,
            snapToLocalTime("00:00", listRange.startDate, listTz),
            endOfDayInTz(listRange.endDate, listTz),
          ),
        ],
      }
    : matching;

  const [list, employeeTotal, scopedTotal] = await Promise.all([
    db.employee.findMany({
      where: listWhere,
      select: employeeSelect,
      orderBy: { user: { name: "asc" } },
      take: EMPLOYEE_LIST_CAP,
    }),
    db.employee.count({ where: listWhere }),
    search || attentionOnly ? db.employee.count({ where: filtered }) : Promise.resolve(-1),
  ]);

  const selectedRow = params.employeeId ? named : (list[0] ?? null);
  const timezone = selectedRow?.site?.timezone ?? firstSite?.timezone ?? FALLBACK_TZ;
  const { today, payPeriods, isCustomRange, startDate, endDate } =
    timezone === listTz ? listRange : await resolveRange(tenantId, params, timezone);
  const rangeStart = snapToLocalTime("00:00", startDate, timezone);
  const rangeEnd = endOfDayInTz(endDate, timezone);

  const listIds = list.map((e) => e.id);
  const flagIds = selectedRow && !listIds.includes(selectedRow.id) ? [...listIds, selectedRow.id] : listIds;

  // Tablet photos for the list and the person open, fetched alongside the
  // punches. Only people already in scope above are looked up, and a failed
  // lookup costs the faces, never the page.
  const photosFor = selectedRow && !listIds.includes(selectedRow.id) ? [...list, selectedRow] : list;
  const photosLoad = tenantId
    ? photoUrls(tenantId, photosFor).catch(() => new Map<string, string | null>())
    : Promise.resolve(new Map<string, string | null>());

  // Open missing punch exceptions and waiting punches in range, for the list's
  // flags and the day headers. Both counted in SQL, for the list at once.
  const [missing, pendingByPerson] = flagIds.length
    ? await Promise.all([
        db.exception.findMany({
          where: { ...missingExceptionWhere(startDate, endDate), timesheet: { employeeId: { in: flagIds } } },
          select: { occurredAt: true, timesheet: { select: { employeeId: true } } },
        }),
        db.punch.groupBy({
          by: ["employeeId"],
          where: { ...pendingPunchWhere(rangeStart, rangeEnd), employeeId: { in: flagIds } },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const flagged = new Set(missing.map((m) => m.timesheet.employeeId));
  const pendingCount = new Map(pendingByPerson.map((g) => [g.employeeId, g._count._all]));

  // Filled in once the punches are read, just before the page data is built.
  let photos = new Map<string, string | null>();
  const toEmployee = (e: (typeof list)[number]) => ({
    id: e.id,
    name: e.user?.name ?? e.employeeCode,
    employeeCode: e.employeeCode,
    department: e.department?.name ?? "No department",
    photoUrl: photos.get(e.id) ?? null,
  });

  let punches: PunchHistoryPunch[] = [];
  let days: PunchHistoryDay[] = [];
  if (selectedRow) {
    const [rows, segments, meals] = await Promise.all([
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
          note: true,
          approvedById: true,
          approvedAt: true,
          createdAt: true,
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
      // The meal the engine took out, per day. With no meal punches this is
      // the automatic deduction, which is otherwise invisible on the page.
      db.workSegment.groupBy({
        by: ["segmentDate"],
        where: {
          timesheet: { employeeId: selectedRow.id },
          segmentType: "MEAL",
          isPaid: false,
          segmentDate: { gte: new Date(`${startDate}T00:00:00.000Z`), lte: new Date(`${endDate}T00:00:00.000Z`) },
        },
        _sum: { durationMinutes: true },
      }),
    ]);

    // Removal markers come out of the list; the punch each one removed is
    // marked instead. Who changed what is stored as an employee id, resolved
    // here to a name inside this tenant.
    const removals = new Map(rows.filter(isRemovalMarker).map((m) => [m.correctsId!, m]));
    const shown = rows.filter((p) => !isRemovalMarker(p));
    const actorIds = [
      ...new Set(
        [...shown, ...removals.values()]
          .filter((p) => p.correctsId || p.source === "MANUAL")
          .map((p) => p.approvedById)
          .filter((id): id is string => !!id),
      ),
    ];
    const actors = actorIds.length
      ? await db.employee.findMany({
          where: { id: { in: actorIds }, ...(tenantId ? { tenantId } : {}) },
          select: { id: true, employeeCode: true, user: { select: { name: true } } },
        })
      : [];
    const actorName = new Map(actors.map((a) => [a.id, a.user?.name ?? a.employeeCode]));
    const changeOf = (kind: "corrected" | "added" | "removed", p: (typeof rows)[number]) => ({
      kind,
      by: p.approvedById ? (actorName.get(p.approvedById) ?? null) : null,
      at: (p.approvedAt ?? p.createdAt).toISOString(),
      reason: humanReason(p.note),
    });

    punches = pairCorrections(shown).map((p) => {
      const removal = removals.get(p.id);
      return {
        id: p.id,
        punchType: p.punchType,
        punchTime: p.punchTime.toISOString(),
        roundedTime: p.roundedTime.toISOString(),
        localDate: localDateOf(p.roundedTime, timezone),
        source: p.source,
        isApproved: p.isApproved,
        isSuperseded: !!p.correctedById,
        isCorrection: !!p.correctsId,
        isRemoved: !!removal,
        change: removal
          ? changeOf("removed", removal)
          : p.correctsId
            ? changeOf("corrected", p)
            : p.source === "MANUAL"
              ? changeOf("added", p)
              : null,
      };
    });

    const worked = new Map(
      segments.map((s) => [s.segmentDate.toISOString().slice(0, 10), s._sum.durationMinutes ?? 0]),
    );
    const mealTaken = new Map(meals.map((s) => [s.segmentDate.toISOString().slice(0, 10), s._sum.durationMinutes ?? 0]));
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
        mealMinutes: mealTaken.get(date) ?? 0,
        hasMissingPunch: missingDays.has(date),
        isClockedIn: date === today && !!lastIn && !outAfter,
        hasPending: live.some((p) => !p.isApproved),
      };
    });
  }

  const live = punches.filter((p) => !p.isSuperseded);
  photos = await photosLoad;
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
    attentionOnly,
    employees: list.map((e) => ({
      ...toEmployee(e),
      hasMissingPunch: flagged.has(e.id),
      pendingCount: pendingCount.get(e.id) ?? 0,
    })),
    employeeTotal,
    scopedTotal: scopedTotal < 0 ? employeeTotal : scopedTotal,
    selected: selectedRow ? { ...toEmployee(selectedRow), site: selectedRow.site?.name ?? null } : null,
    punches,
    days,
    totals: {
      workedMinutes: days.reduce((n, d) => n + d.workedMinutes, 0),
      punches: punches.length,
      pending: live.filter((p) => !p.isApproved).length,
      daysWorked: new Set(live.filter((p) => p.punchType === "CLOCK_IN").map((p) => p.localDate)).size,
      missingDays: days.filter((d) => d.hasMissingPunch).length,
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
  status: "Approved" | "Pending" | "Superseded" | "Removed";
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
  const tz = firstSite?.timezone ?? FALLBACK_TZ;
  const { startDate, endDate } = await resolveRange(tenantId, params, tz);
  // The same people the list shows, Needs attention included.
  const whom: Prisma.EmployeeWhereInput =
    params.show === "attention"
      ? {
          AND: [
            matching,
            attentionWhere(startDate, endDate, snapToLocalTime("00:00", startDate, tz), endOfDayInTz(endDate, tz)),
          ],
        }
      : matching;

  // A day either side, because each site draws its own midnight. Rows outside
  // their own site's dates are dropped below.
  const where: Prisma.PunchWhereInput = {
    isRejected: false,
    employee: whom,
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
        note: true,
      },
    }),
    db.employee.findMany({
      where: whom,
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

  // A removal marker is not a punch: the punch it removed is written as Removed.
  const removed = new Set(punches.filter(isRemovalMarker).map((m) => m.correctsId!));
  const rows: PunchExportRow[] = [];
  for (const p of pairCorrections(punches.filter((x) => !isRemovalMarker(x)))) {
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
      status: removed.has(p.id) ? "Removed" : p.correctedById ? "Superseded" : p.isApproved ? "Approved" : "Pending",
      isCorrection: !!p.correctsId,
    });
  }
  // By person, then in the order they happened, which is how payroll reads it.
  rows.sort((a, b) => a.employee.localeCompare(b.employee) || a.employeeCode.localeCompare(b.employeeCode));
  return { ok: true, startDate, endDate, rows };
}
