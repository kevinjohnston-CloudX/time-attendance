import { db } from "@/lib/db";
import { snapToLocalTime } from "@/lib/utils/date";
import { DAYS_BACK, addDays, clampDay } from "./days";
import { photoUrls } from "./photos";
import { expectedHours, shiftHoursOn, SHIFT_HOURS_SELECT } from "./expected-hours";
import { EFFECTIVE_STATE_SQL, PUNCH_CHAIN, PUNCH_CHAIN_JOINS, currentPunch } from "./effective-punch";
import { isHere, scansElsewhere, scansHere, scansHereSql, siteOf, siteScope } from "./site-scope";
import { NOT_COUNTED_OUTCOMES } from "./scan-rules";
import { clockStateAfter } from "./lanes";
import type {
  PresenceBoard,
  PresenceDetail,
  PresenceScan,
  PresencePerson,
  PresenceStatus,
} from "./types";

/** A built in role's name, for somebody with no custom role picked. The same words as the employee record. */
const SYSTEM_ROLE_NAME: Record<string, string> = {
  EMPLOYEE: "Employee",
  SUPERVISOR: "Supervisor",
  PAYROLL_ADMIN: "Payroll Admin",
  HR_ADMIN: "HR Admin",
  SYSTEM_ADMIN: "System Admin",
  SUPER_ADMIN: "Super Admin",
};

/**
 * Who is in the building at one site, right now.
 *
 * <p>Built on `scan_events`, not on punches, because the question is what the
 * readers saw rather than what the timecard concluded. The two streams stay
 * separate all the way through and are only combined at the very end, into
 * one status per person (see {@link PresenceStatus}).
 *
 * <p>Read-only. Nothing here writes, and nothing here is called on a timer by
 * the server: the board polls it, so its cost is paid once per open screen
 * every 30 seconds. That is why every query is bounded by a time window and a
 * site, and why the aggregation happens in SQL rather than in a loop over
 * every scan.
 */

/**
 * How far back a scan can still decide somebody's state.
 *
 * <p>The nightly auto-close writes an OUT for anybody left IN, so in practice
 * nobody's latest row is older than one night. 36 hours covers a night shift
 * that started yesterday evening plus a missed auto-close run, without letting
 * a week-old arrival keep somebody "inside" forever.
 */
export const LOOKBACK_MS = 36 * 60 * 60 * 1000;

/** Rows that record what the system did, not what a reader saw. */
const SYSTEM_SOURCES = ["AUTO_CLOSE", "SEEDED"] as const;

type LatestRow = {
  employeeId: string;
  stream: "SECURITY" | "TIME_CLOCK";
  direction: "IN" | "OUT";
  source: string;
  scanTime: Date;
  stateAfter: string | null;
  siteCode: string | null;
  homeSiteId: string | null;
};

type TodayRow = { employeeId: string; firstIn: Date | null; lastOut: Date | null };

export function localDateString(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);
}

/**
 * The sites this viewer may open.
 *
 * <p>HR admins can be restricted to named sites through `HrSiteAccess`; no
 * rows means unrestricted, which is how the rest of the app reads it too.
 * Everybody else holding the permission sees the whole tenant.
 */
export async function getViewableSites(
  tenantId: string,
  viewer: { employeeId: string; role: string },
) {
  let restrictTo: string[] | null = null;
  if (viewer.role === "HR_ADMIN" && viewer.employeeId) {
    const rows = await db.hrSiteAccess.findMany({
      where: { employeeId: viewer.employeeId },
      select: { siteId: true },
    });
    if (rows.length > 0) restrictTo = rows.map((r) => r.siteId);
  }

  return db.site.findMany({
    where: { tenantId, isActive: true, ...(restrictTo ? { id: { in: restrictTo } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, timezone: true },
  });
}

/**
 * One site's board. The caller has already checked the permission and that
 * `siteId` is one of {@link getViewableSites}; the site is still re-read here
 * scoped by tenant, so a stray id answers null rather than another company's
 * building.
 */
export async function getPresenceBoard(tenantId: string, siteId: string): Promise<PresenceBoard | null> {
  const site = await db.site.findFirst({
    where: { id: siteId, tenantId, isActive: true },
    select: { id: true, name: true, timezone: true },
  });
  if (!site) return null;

  const now = new Date();
  const timezone = site.timezone || "America/New_York";
  const today = localDateString(now, timezone);
  const todayStart = snapToLocalTime("00:00", today, timezone);
  const windowStart = new Date(now.getTime() - LOOKBACK_MS);
  const workDate = new Date(`${today}T00:00:00.000Z`);
  // The scans made at this building, whoever made them (see site-scope.ts).
  const scope = await siteScope(tenantId, siteId);
  const here = scansHereSql(scope);

  const [latest, todayRows, lastGate, scheduled, leaveRequests, onLeaveFlags, roster] = await Promise.all([
    // Newest IN/OUT per person per stream. UNKNOWN is left out before the
    // DISTINCT ON, not after, so an unresolvable scan never hides the real
    // state underneath it. So is a time clock scan the timecard refused: it
    // changed nothing, and the person panel's lanes read it the same way.
    // Taken at every building: a person whose newest gate scan is at another
    // building is there, not here, and the time clock follows the person
    // (see below).
    db.$queryRaw<(LatestRow & { here: boolean })[]>`
      SELECT DISTINCT ON (s."employeeId", s."stream")
             ${here}                   AS here,
             s."employeeId"            AS "employeeId",
             s."stream"::text          AS stream,
             s."direction"::text       AS direction,
             s."directionSource"::text AS source,
             s."scanTime"              AS "scanTime",
             COALESCE(${EFFECTIVE_STATE_SQL}, s."timecardStateAfter") AS "stateAfter",
             s."site"                  AS "siteCode",
             e."siteId"                AS "homeSiteId"
      FROM   "scan_events" s
      JOIN   "employees" e ON e.id = s."employeeId"
      ${PUNCH_CHAIN_JOINS}
      WHERE  s."tenantId" = ${tenantId}
        AND  e."tenantId" = ${tenantId}
        AND  s."scanTime" >= ${windowStart}
        AND  s."direction" IN ('IN', 'OUT')
        AND  NOT (s."stream" = 'TIME_CLOCK' AND s."outcome"::text IN ('PUNCH_REJECTED', 'ERROR', 'PENDING'))
      ORDER  BY s."employeeId", s."stream", s."scanTime" DESC
    `,
    // What each person actually did at a reader today. System rows are left
    // out: an auto-close at 11 PM last night is not somebody leaving today.
    db.$queryRaw<TodayRow[]>`
      SELECT s."employeeId" AS "employeeId",
             MIN(s."scanTime") FILTER (WHERE s."direction" = 'IN')  AS "firstIn",
             MAX(s."scanTime") FILTER (WHERE s."direction" = 'OUT') AS "lastOut"
      FROM   "scan_events" s
      JOIN   "employees" e ON e.id = s."employeeId"
      WHERE  s."tenantId" = ${tenantId}
        AND  e."tenantId" = ${tenantId}
        AND  ${here}
        AND  s."scanTime" >= ${todayStart}
        AND  s."direction" IN ('IN', 'OUT')
        AND  s."directionSource"::text NOT IN (${SYSTEM_SOURCES[0]}, ${SYSTEM_SOURCES[1]})
      GROUP  BY s."employeeId"
    `,
    // Whether this building's gate is reporting at all.
    db.scanEvent.findFirst({
      where: {
        tenantId,
        stream: "SECURITY",
        deviceName: { not: null },
        scanTime: { gte: windowStart },
        directionSource: { notIn: [...SYSTEM_SOURCES] },
        AND: [scansHere(scope)],
      },
      orderBy: { scanTime: "desc" },
      select: { scanTime: true },
    }),
    db.scheduleDay.findMany({
      where: { tenantId, workDate, isWorkday: true, employee: { siteId, isActive: true } },
      select: { employeeId: true, startTime: true, endTime: true },
    }),
    db.leaveRequest.findMany({
      where: {
        status: { in: ["APPROVED", "POSTED"] },
        startDate: { lte: workDate },
        endDate: { gte: workDate },
        employee: { tenantId, siteId, isActive: true },
      },
      select: { employeeId: true },
    }),
    db.employee.findMany({
      where: { tenantId, siteId, isActive: true, onLeave: true },
      select: { id: true },
    }),
    // Everybody whose home is this site, so the board's All view is the whole
    // roster and not only the people who have a reason to be here today.
    db.employee.findMany({
      where: { tenantId, siteId, isActive: true },
      select: { id: true },
    }),
  ]);

  const gateById = new Map<string, LatestRow>();
  const clockById = new Map<string, LatestRow>();
  for (const row of latest) {
    if (!row.here) continue;
    (row.stream === "SECURITY" ? gateById : clockById).set(row.employeeId, row);
  }
  const todayById = new Map(todayRows.map((r) => [r.employeeId, r]));
  // The time clock follows the person: for anybody who scanned here today or
  // is still here from last night, their newest time clock scan counts
  // wherever they made it, since a shift that moves between warehouses is one
  // shift. Another building's gate only says whether they are inside it now.
  const appeared = new Set([
    ...todayById.keys(),
    ...[...gateById.values()].filter((r) => r.direction === "IN").map((r) => r.employeeId),
    ...[...clockById.values()].filter((r) => clockStateOf(r) !== "OUT").map((r) => r.employeeId),
  ]);
  const awayById = new Map<string, LatestRow>();
  for (const row of latest) {
    if (row.here) continue;
    const id = row.employeeId;
    if (!appeared.has(id)) continue;
    if (row.stream === "TIME_CLOCK") clockById.set(id, row);
    else if (row.direction === "IN" && row.source !== "AUTO_CLOSE") awayById.set(id, row);
  }
  const scheduleById = new Map(scheduled.map((s) => [s.employeeId, s]));
  const onLeave = new Set([...leaveRequests.map((l) => l.employeeId), ...onLeaveFlags.map((e) => e.id)]);
  const hasGateData = lastGate !== null;
  const rosterIds = new Set(roster.map((e) => e.id));

  const ids = new Set<string>([
    ...gateById.keys(),
    ...clockById.keys(),
    ...todayById.keys(),
    ...scheduleById.keys(),
    ...onLeave,
    ...rosterIds,
  ]);

  const employees = ids.size
    ? await db.employee.findMany({
        // Already scoped: every id came from a scan here or from this site's
        // own schedules and leave.
        where: { tenantId, id: { in: [...ids] } },
        select: {
          id: true,
          employeeCode: true,
          site: { select: { id: true, name: true } },
          barcode: true,
          wmsId: true,
          isActive: true,
          terminatedAt: true,
          user: { select: { name: true } },
          jobTitle: true,
          payType: true,
          department: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true, ...SHIFT_HOURS_SELECT } },
        },
      })
    : [];

  const photos = await photoUrls(tenantId, employees);
  const people: PresencePerson[] = [];

  for (const emp of employees) {
    const gate = gateById.get(emp.id);
    const clock = clockById.get(emp.id);
    const todayActivity = todayById.get(emp.id);
    // The shift on their record, or the WMS day for anybody it cannot answer
    // for (see expected-hours.ts).
    // Only this site's own people are expected here; a visitor's shift is
    // their home building's business.
    const schedule = expectedHours(rosterIds.has(emp.id) ? emp.shift : null, scheduleById.get(emp.id), today);

    const gateIn = gate?.direction === "IN";
    const clockState = clockStateOf(clock);
    const awayRow = gateIn ? undefined : awayById.get(emp.id);

    let status: PresenceStatus | null = null;
    let inside = false;
    let outsideOnMeal = false;
    let breakKind: "MEAL" | "BREAK" | null = null;
    let since: Date | null = null;
    let elsewhere: string | null = null;

    if (clockState !== "OUT" && awayRow) {
      // On the clock and inside another building: their shift carries on
      // there. Not counted here, and not a missed gate scan.
      status = "ELSEWHERE";
      breakKind = clockState === "WORK" ? null : clockState;
      since = awayRow.scanTime;
      elsewhere = siteOf(scope, awayRow.siteCode, awayRow.homeSiteId);
    } else if (clockState === "WORK") {
      status = hasGateData && !gateIn ? "NO_GATE_SCAN" : "WORKING";
      // The building total follows the gate, as Movements does: somebody the
      // gate has outside is listed as clocked in and not inside, not counted.
      inside = status === "WORKING";
      since = clock!.scanTime;
    } else if (clockState === "MEAL" || clockState === "BREAK") {
      status = "ON_MEAL";
      breakKind = clockState;
      outsideOnMeal = hasGateData && !gateIn;
      inside = !outsideOnMeal;
      since = clock!.scanTime;
    } else if (gateIn) {
      // Salaried people are not expected to clock in, so for them being
      // through the gate is being at work, not a warning.
      status = emp.payType === "SALARY" ? "ON_SITE" : "OFF_CLOCK";
      inside = true;
      // Inside since whichever came last: walking through the gate, or
      // clocking out while still in the building.
      since = latestOf(gate!.scanTime, clock?.scanTime ?? null);
    } else if (todayActivity) {
      status = "LEFT";
      since = todayActivity.lastOut ?? latestOf(gate?.scanTime ?? null, clock?.scanTime ?? null);
    } else if (onLeave.has(emp.id)) {
      status = "ON_LEAVE";
    } else if (schedule) {
      status = "NOT_ARRIVED";
    } else if (rosterIds.has(emp.id)) {
      // Only this site's own people. Somebody from another building who
      // scanned here yesterday is not this roster's to list.
      status = "NOT_SCHEDULED";
    }

    if (!status) continue;

    let lateMinutes: number | null = null;
    // Lateness is an hourly measure. Salaried people keep their own hours.
    if (status === "NOT_ARRIVED" && schedule?.start && emp.payType !== "SALARY") {
      const start = snapToLocalTime(schedule.start, today, timezone);
      const late = Math.floor((now.getTime() - start.getTime()) / 60000);
      lateMinutes = late > 0 ? late : null;
    }

    people.push({
      id: emp.id,
      name: emp.user?.name?.trim() || `Employee ${emp.employeeCode}`,
      employeeCode: emp.employeeCode,
      departmentId: emp.department?.id ?? null,
      department: emp.department?.name ?? null,
      jobTitle: emp.jobTitle?.trim() || null,
      shiftId: emp.shift?.id ?? null,
      shift: emp.shift?.name ?? null,
      photoUrl: photos.get(emp.id) ?? null,
      salaried: emp.payType === "SALARY",
      status,
      inside,
      breakKind,
      outsideOnMeal,
      since: since ? since.toISOString() : null,
      firstInToday: todayActivity?.firstIn ? todayActivity.firstIn.toISOString() : null,
      scheduledStart: schedule?.start ?? null,
      scheduledEnd: schedule?.end ?? null,
      lateMinutes,
      inactive: !emp.isActive || emp.terminatedAt !== null,
      homeSite: emp.site && emp.site.id !== siteId ? emp.site.name : null,
      elsewhere,
      gate: gate
        ? { inside: gateIn, at: gate.scanTime.toISOString(), automatic: gate.source === "AUTO_CLOSE" }
        : null,
      clock: clock
        ? { state: clockState, at: clock.scanTime.toISOString(), automatic: clock.source === "AUTO_CLOSE" }
        : null,
    });
  }

  return {
    site: {
      id: site.id,
      name: site.name,
      timezone,
      hasGateData,
      lastGateScanAt: lastGate ? lastGate.scanTime.toISOString() : null,
    },
    generatedAt: now.toISOString(),
    people,
  };
}

/**
 * The time clock's view of somebody, as WORK / MEAL / BREAK / OUT.
 *
 * <p>The pipeline's own verdict wins when it recorded one, because only it can
 * tell a meal from a clock-out: both are an OUT at the tablet. A scan the
 * pipeline refused has no verdict, and falls back to the direction the tablet
 * resolved. An auto-close is always OUT.
 */
function clockStateOf(row: LatestRow | undefined): "WORK" | "MEAL" | "BREAK" | "OUT" {
  if (!row || row.source === "AUTO_CLOSE") return "OUT";
  const state = row.stateAfter?.toUpperCase();
  if (state === "WORK" || state === "MEAL" || state === "BREAK" || state === "OUT") return state;
  return row.direction === "IN" ? "WORK" : "OUT";
}

function latestOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * One person's day at the readers, for the side panel: every scan that day,
 * and the last scan of each kind before it, so the day can start from where
 * the night before left them.
 *
 * <p>`day` is a site calendar day within the last week; anything else reads
 * as today. The scans made at this building are read, the same ones the
 * table shows, and on a day they scanned here, their time clock and gate
 * scans at other buildings too (see lanes.ts). Somebody opens when this is their site or they scanned
 * here in the days the page can show; any other id finds nothing, and the
 * caller answers as if the person does not exist.
 */
export async function getPresenceDetail(
  tenantId: string,
  siteId: string,
  employeeId: string,
  day?: string | null,
): Promise<PresenceDetail | null> {
  const [site, scope] = await Promise.all([
    db.site.findFirst({ where: { id: siteId, tenantId }, select: { timezone: true } }),
    siteScope(tenantId, siteId),
  ]);
  if (!site) return null;
  const here = scansHere(scope);
  const timezone = site.timezone || "America/New_York";
  const now = new Date();
  const today = localDateString(now, timezone);
  const oldest = snapToLocalTime("00:00", addDays(today, -DAYS_BACK), timezone);

  const emp = await db.employee.findFirst({
    where: {
      id: employeeId,
      tenantId,
      OR: [
        { siteId },
        { scanEvents: { some: { AND: [here], tenantId, scanTime: { gte: new Date(oldest.getTime() - LOOKBACK_MS) } } } },
      ],
    },
    select: {
      id: true,
      employeeCode: true,
      jobTitle: true,
      payType: true,
      barcode: true,
      wmsId: true,
      isActive: true,
      terminatedAt: true,
      user: { select: { name: true } },
      department: { select: { name: true } },
      shift: { select: { name: true, ...SHIFT_HOURS_SELECT } },
      supervisor: { select: { user: { select: { name: true } } } },
      site: { select: { id: true, name: true } },
      hireDate: true,
      role: true,
      customRole: { select: { name: true } },
    },
  });
  if (!emp) return null;

  const theDay = clampDay(day, today) ?? today;
  const dayStart = snapToLocalTime("00:00", theDay, timezone);
  const dayEnd = snapToLocalTime("00:00", addDays(theDay, 1), timezone);
  const carryFrom = new Date(dayStart.getTime() - LOOKBACK_MS);

  const scanSelect = {
    id: true,
    scanTime: true,
    stream: true,
    direction: true,
    directionSource: true,
    timecardPunchType: true,
    deviceName: true,
    outcome: true,
    punch: PUNCH_CHAIN,
  } as const;

  // The state at midnight: the newest IN or OUT of each kind before the day,
  // at any building, as Movements reads it: somebody whose last gate scan was
  // at another building is not still inside this one.
  const carry = (stream: "SECURITY" | "TIME_CLOCK") =>
    db.scanEvent.findFirst({
      where: {
        employeeId,
        tenantId,
        stream,
        direction: { in: ["IN", "OUT"] },
        scanTime: { gte: carryFrom, lt: dayStart },
        ...(stream === "TIME_CLOCK" ? { outcome: { notIn: [...NOT_COUNTED_OUTCOMES] } } : {}),
      },
      orderBy: { scanTime: "desc" },
      select: { ...scanSelect, site: true },
    });

  const [schedule, scans, lastGate, lastClock, elsewhere, photos] = await Promise.all([
    db.scheduleDay.findFirst({
      where: { employeeId, tenantId, workDate: new Date(`${theDay}T00:00:00.000Z`), isWorkday: true },
      select: { startTime: true, endTime: true },
    }),
    db.scanEvent.findMany({
      where: { employeeId, tenantId, scanTime: { gte: dayStart, lt: dayEnd }, AND: [here] },
      orderBy: { scanTime: "desc" },
      take: 400,
      select: scanSelect,
    }),
    carry("SECURITY"),
    carry("TIME_CLOCK"),
    db.scanEvent.findMany({
      where: { employeeId, tenantId, scanTime: { gte: dayStart, lt: dayEnd }, AND: [scansElsewhere(scope)] },
      orderBy: { scanTime: "desc" },
      take: 400,
      select: { ...scanSelect, site: true },
    }),
    photoUrls(tenantId, [{ id: emp.id, barcode: emp.barcode, wmsId: emp.wmsId, employeeCode: emp.employeeCode }]),
  ]);
  const homeSiteId = emp.site?.id ?? null;
  const gateHere = lastGate && isHere(scope, lastGate.site, homeSiteId) ? lastGate : null;
  const clockHere = lastClock && isHere(scope, lastClock.site, homeSiteId) ? lastClock : null;
  const carryGate = gateHere ? toScan(withCurrentPunch(gateHere)) : null;
  const carryClockHere = clockHere ? toScan(withCurrentPunch(clockHere)) : null;
  // Scanned here that day, or still here from last night: then the time clock
  // is theirs from every building, and another building's gate says whether
  // they were inside it.
  const appeared =
    scans.length > 0 ||
    (!!carryGate && carryGate.direction === "IN" && !carryGate.automatic) ||
    (!!carryClockHere && clockStateAfter(carryClockHere) !== "OUT");
  const elsewhereScan = (r: (typeof elsewhere)[number]) => ({
    ...toScan(withCurrentPunch(r)),
    site: siteOf(scope, r.site, homeSiteId),
  });
  const carryClock = appeared && lastClock && !clockHere ? elsewhereScan(lastClock) : carryClockHere;
  const carryAway = appeared && lastGate && !gateHere ? elsewhereScan(lastGate) : null;
  const dayScans = [
    ...scans.map((s) => toScan(withCurrentPunch(s))),
    ...(appeared ? elsewhere.filter((s) => s.stream === "TIME_CLOCK").map(elsewhereScan) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const expected = expectedHours(emp.shift, schedule ?? undefined, theDay);
  // Whose answer the hours are, even when the answer is "not this day": a
  // shift that is off today still decides, and WMS may still disagree.
  const scheduleSource =
    shiftHoursOn(emp.shift, theDay) !== undefined ? ("SHIFT" as const) : schedule ? ("WMS" as const) : null;

  return {
    id: emp.id,
    name: emp.user?.name?.trim() || `Employee ${emp.employeeCode}`,
    employeeCode: emp.employeeCode,
    jobTitle: emp.jobTitle,
    department: emp.department?.name ?? null,
    shift: emp.shift?.name ?? null,
    supervisor: emp.supervisor?.user?.name ?? null,
    salaried: emp.payType === "SALARY",
    inactive: !emp.isActive || emp.terminatedAt !== null,
    homeSite: emp.site && emp.site.id !== siteId ? emp.site.name : null,
    site: emp.site?.name ?? null,
    role: emp.customRole?.name ?? SYSTEM_ROLE_NAME[emp.role] ?? null,
    hireDate: emp.hireDate ? emp.hireDate.toISOString().slice(0, 10) : null,
    shiftStart: emp.shift?.startTime || null,
    shiftEnd: emp.shift?.endTime || null,
    photoUrl: photos.get(emp.id) ?? null,
    scheduledStart: expected?.start ?? null,
    scheduledEnd: expected?.end ?? null,
    scheduleSource,
    wmsStart: schedule?.startTime ?? null,
    wmsEnd: schedule?.endTime ?? null,
    wmsScheduled: !!schedule,
    timezone,
    day: theDay,
    today,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    scans: dayScans,
    carryGate,
    carryClock,
    away: appeared ? elsewhere.filter((s) => s.stream === "SECURITY").map(elsewhereScan).reverse() : [],
    carryAway,
  };
}

export type ScanRow = {
  id: string;
  scanTime: Date;
  stream: "SECURITY" | "TIME_CLOCK";
  direction: "IN" | "OUT" | "UNKNOWN";
  directionSource: string;
  timecardPunchType: string | null;
  deviceName: string | null;
  outcome: string;
  /** The punch type after any approved correction, when it is known. */
  currentPunchType?: string | null;
};

/** A scan read with its punch chain, reduced to the punch type in force now. */
export function withCurrentPunch<T extends ScanRow & { punch?: Parameters<typeof currentPunch>[0] }>(r: T): ScanRow {
  return { ...r, currentPunchType: currentPunch(r.punch)?.punchType ?? null };
}

export function toScan(s: ScanRow): PresenceScan {
  const type = s.currentPunchType ?? s.timecardPunchType;
  return {
    id: s.id,
    at: s.scanTime.toISOString(),
    stream: s.stream,
    direction: s.direction,
    punchType: type,
    correctedFrom: s.timecardPunchType && type !== s.timecardPunchType ? s.timecardPunchType : null,
    device: s.deviceName,
    automatic: s.directionSource === "AUTO_CLOSE" || s.directionSource === "SEEDED",
    reread: s.directionSource === "REREAD",
    rejected: s.stream === "TIME_CLOCK" && (NOT_COUNTED_OUTCOMES as readonly string[]).includes(s.outcome),
  };
}
