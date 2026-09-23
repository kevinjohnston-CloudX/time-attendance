import { db } from "@/lib/db";
import { snapToLocalTime } from "@/lib/utils/date";
import { addDays, clampDay } from "./days";
import { LOOKBACK_MS, localDateString, toScan, type ScanRow } from "./on-site.service";
import { photoUrls } from "./photos";
import type { DayPerson, PresenceScan, SiteDay } from "./types";

/**
 * One site's whole day, for the Movements view: who was scheduled, who was on
 * leave, every scan each person made, and where the night before left them.
 *
 * <p>This returns what was recorded, not a verdict. The browser builds each
 * person's movement lines from it with the lane logic in lanes.ts, the same
 * code the person panel draws with, so the two can never disagree and an open
 * stretch keeps counting between refreshes.
 *
 * <p>Read-only, and bounded: one site, one calendar day, capped at MAX_SCANS.
 * A site of 400 people makes about 2,000 scans a day. The poll first asks
 * whether anything new was recorded, and only then reads the day again.
 */

const MAX_SCANS = 20_000;
/** Even with no new scans, a day is re-read this often, for schedule and leave edits. */
const MAX_UNCHANGED_MS = 5 * 60 * 1000;
const SYSTEM_SOURCES = ["AUTO_CLOSE", "SEEDED"];

type CarryRow = ScanRow & { employeeId: string };

export async function getSiteDay(
  tenantId: string,
  siteId: string,
  input: { day?: string | null; since?: { watermark: string | null; generatedAt: string } | null },
): Promise<SiteDay | { unchanged: true } | null> {
  const site = await db.site.findFirst({
    where: { id: siteId, tenantId, isActive: true },
    select: { id: true, name: true, timezone: true },
  });
  if (!site) return null;

  const timezone = site.timezone || "America/New_York";
  const now = new Date();
  const today = localDateString(now, timezone);
  const day = clampDay(input.day, today) ?? today;
  const dayStart = snapToLocalTime("00:00", day, timezone);
  const dayEnd = snapToLocalTime("00:00", addDays(day, 1), timezone);
  const workDate = new Date(`${day}T00:00:00.000Z`);
  const atSite = { tenantId, scanTime: { gte: dayStart, lt: dayEnd }, employee: { siteId } };

  const newest = await db.scanEvent.aggregate({ where: atSite, _max: { createdAt: true } });
  const watermark = newest._max.createdAt?.toISOString() ?? null;

  // Nothing new since the browser's copy, and that copy is recent: say so and
  // stop, rather than reading and sending the whole day again.
  const since = input.since;
  if (
    since &&
    since.watermark === watermark &&
    Date.parse(since.generatedAt) > now.getTime() - MAX_UNCHANGED_MS
  ) {
    return { unchanged: true };
  }

  const [rows, carryRows, lastGate, schedules, leave, onLeaveFlags] = await Promise.all([
    // Newest first so a cap drops the oldest, then turned round below.
    db.scanEvent.findMany({
      where: atSite,
      orderBy: [{ scanTime: "desc" }, { id: "desc" }],
      take: MAX_SCANS + 1,
      select: {
        id: true,
        employeeId: true,
        scanTime: true,
        stream: true,
        direction: true,
        directionSource: true,
        timecardPunchType: true,
        deviceName: true,
        outcome: true,
      },
    }),
    // Where each person stood at midnight: their last IN or OUT of each kind
    // in the 36 hours before, leaving out time clock scans the timecard refused.
    db.$queryRaw<CarryRow[]>`
      SELECT DISTINCT ON (s."employeeId", s."stream")
             s."employeeId"              AS "employeeId",
             s.id                        AS id,
             s."scanTime"                AS "scanTime",
             s."stream"::text            AS stream,
             s."direction"::text         AS direction,
             s."directionSource"::text   AS "directionSource",
             s."timecardPunchType"       AS "timecardPunchType",
             s."deviceName"              AS "deviceName",
             s."outcome"::text           AS outcome
      FROM   "scan_events" s
      JOIN   "employees" e ON e.id = s."employeeId"
      WHERE  s."tenantId" = ${tenantId}
        AND  e."tenantId" = ${tenantId}
        AND  e."siteId" = ${siteId}
        AND  s."scanTime" >= ${new Date(dayStart.getTime() - LOOKBACK_MS)}
        AND  s."scanTime" < ${dayStart}
        AND  s."direction" IN ('IN', 'OUT')
        AND  NOT (s."stream" = 'TIME_CLOCK' AND s."outcome"::text IN ('PUNCH_REJECTED', 'ERROR', 'PENDING'))
      ORDER  BY s."employeeId", s."stream", s."scanTime" DESC
    `,
    // Whether this building's gate reports at all, around this day.
    db.scanEvent.findFirst({
      where: {
        tenantId,
        stream: "SECURITY",
        scanTime: { gte: new Date(dayStart.getTime() - LOOKBACK_MS), lt: dayEnd },
        directionSource: { notIn: SYSTEM_SOURCES as never },
        employee: { siteId },
      },
      select: { id: true },
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
    // The standing "on leave" flag only says something about today.
    day === today
      ? db.employee.findMany({ where: { tenantId, siteId, isActive: true, onLeave: true }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ]);

  const truncated = rows.length > MAX_SCANS;
  const scans: Record<string, PresenceScan[]> = {};
  for (const r of rows.slice(0, MAX_SCANS).reverse()) {
    if (!r.employeeId) continue;
    (scans[r.employeeId] ??= []).push(toScan(r));
  }

  // A night that ended outside and off the clock says nothing about today,
  // so only a carry that leaves somebody inside or on the clock brings them in.
  const carry: SiteDay["carry"] = {};
  const carriedIn = new Set<string>();
  for (const r of carryRows) {
    const scan = toScan(r);
    const entry = (carry[r.employeeId] ??= { gate: null, clock: null });
    if (scan.stream === "SECURITY") entry.gate = scan;
    else entry.clock = scan;
    const stillIn =
      !scan.automatic && (scan.stream === "SECURITY" ? scan.direction === "IN" : isOnTheClock(scan));
    if (stillIn) carriedIn.add(r.employeeId);
  }

  const scheduleById = new Map(schedules.map((s) => [s.employeeId, s]));
  const leaveIds = new Set([...leave.map((l) => l.employeeId), ...onLeaveFlags.map((e) => e.id)]);
  const ids = new Set([...Object.keys(scans), ...carriedIn, ...scheduleById.keys(), ...leaveIds]);

  const employees = ids.size
    ? await db.employee.findMany({
        where: { tenantId, siteId, id: { in: [...ids] } },
        select: {
          id: true,
          employeeCode: true,
          barcode: true,
          wmsId: true,
          isActive: true,
          terminatedAt: true,
          user: { select: { name: true } },
          department: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true } },
        },
      })
    : [];

  const photos = await photoUrls(tenantId, employees);
  const people: DayPerson[] = employees.map((e) => {
    const schedule = scheduleById.get(e.id);
    return {
      id: e.id,
      name: e.user?.name?.trim() || `Employee ${e.employeeCode}`,
      employeeCode: e.employeeCode,
      departmentId: e.department?.id ?? null,
      department: e.department?.name ?? null,
      shiftId: e.shift?.id ?? null,
      shift: e.shift?.name ?? null,
      photoUrl: photos.get(e.id) ?? null,
      inactive: !e.isActive || e.terminatedAt !== null,
      scheduledStart: schedule?.startTime ?? null,
      scheduledEnd: schedule?.endTime ?? null,
      onLeave: leaveIds.has(e.id),
    };
  });

  // Carry only matters for the people on the list.
  const kept = new Set(people.map((p) => p.id));
  for (const id of Object.keys(carry)) if (!kept.has(id)) delete carry[id];

  return {
    site: { id: site.id, name: site.name, timezone, hasGateData: lastGate !== null },
    day,
    today,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    generatedAt: now.toISOString(),
    watermark,
    people,
    scans,
    carry,
    truncated,
  };
}

function isOnTheClock(s: PresenceScan): boolean {
  switch (s.punchType) {
    case "CLOCK_IN":
    case "MEAL_END":
    case "BREAK_END":
    case "MEAL_START":
    case "BREAK_START":
      return true;
    case "CLOCK_OUT":
      return false;
  }
  return s.direction === "IN";
}
