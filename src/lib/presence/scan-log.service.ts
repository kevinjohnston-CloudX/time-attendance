import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { snapToLocalTime } from "@/lib/utils/date";
import { localDateString } from "./on-site.service";
import type { ScanLogPage, ScanLogQuery, ScanLogRow } from "./types";

/**
 * Every reader event at one site today, from both the security gate and the
 * time clock, newest first.
 *
 * <p>The board answers "where is everybody now" from each person's latest
 * scan. This answers "what happened", so it keeps every scan, including the
 * ones the board reads past: a second trip out through the gate, a meal that
 * started twice, a clock in the timecard refused.
 *
 * <p>Read-only, and bounded the same way the board is: one site, one day, one
 * page at a time. The poll asks only for rows recorded since the last answer,
 * so an open log costs a small query every 30 seconds rather than the whole
 * day again.
 *
 * <p>Scoped by the scanning employee's site, like the board, because the gates
 * post numeric location ids that never join the site table. A badge that
 * matches nobody has no employee and so no site, and is not in this log.
 */

const REJECTED = ["PUNCH_REJECTED", "ERROR"] as const;

/**
 * A time clock scan is in or out by what the timecard made of it, when it
 * said: the row reads "Clocked out", so it counts, filters and draws as out,
 * even on the rare row where the tablet's own direction disagrees. The People
 * view reads the time clock the same way. Only when the timecard said nothing
 * does the tablet's direction decide.
 */
const CLOCK_IN_TYPES = ["CLOCK_IN", "MEAL_END", "BREAK_END"];
const CLOCK_OUT_TYPES = ["CLOCK_OUT", "MEAL_START", "BREAK_START"];
const CLOCK_TYPES = [...CLOCK_IN_TYPES, ...CLOCK_OUT_TYPES];

function clockDirection(punchType: string | null, direction: "IN" | "OUT" | "UNKNOWN"): "IN" | "OUT" | "UNKNOWN" {
  if (punchType && CLOCK_IN_TYPES.includes(punchType)) return "IN";
  if (punchType && CLOCK_OUT_TYPES.includes(punchType)) return "OUT";
  return direction;
}

function directionWhere(stream: "SECURITY" | "TIME_CLOCK", dir: "IN" | "OUT"): Prisma.ScanEventWhereInput {
  if (stream === "SECURITY") return { direction: dir };
  return {
    OR: [
      { timecardPunchType: { in: dir === "IN" ? CLOCK_IN_TYPES : CLOCK_OUT_TYPES } },
      {
        direction: dir,
        OR: [{ timecardPunchType: null }, { timecardPunchType: { notIn: CLOCK_TYPES } }],
      },
    ],
  };
}

const PAGE = 100;
const MAX_PAGE = 5000;
/** A poll that finds more than this many new rows starts over from the top. */
const MAX_NEW = 200;

export interface ScanLogInput extends ScanLogQuery {
  /** Rows older than this one, for "show more". */
  before?: { at: string; id: string } | null;
  /** Rows recorded after this moment, for the poll. */
  since?: string | null;
  limit?: number;
}

export async function getScanLog(
  tenantId: string,
  siteId: string,
  input: ScanLogInput,
): Promise<ScanLogPage | null> {
  const site = await db.site.findFirst({
    where: { id: siteId, tenantId, isActive: true },
    select: { timezone: true },
  });
  if (!site) return null;

  const timezone = site.timezone || "America/New_York";
  const day = localDateString(new Date(), timezone);
  const dayStart = snapToLocalTime("00:00", day, timezone);

  const q = input.q?.trim() || null;
  const employee: Prisma.EmployeeWhereInput = {
    tenantId,
    siteId,
    ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    ...(input.shiftId ? { shiftId: input.shiftId } : {}),
    ...(q
      ? {
          OR: [
            { employeeCode: { contains: q, mode: "insensitive" } },
            { user: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  // What the counts cover: the day, the site and the people filters.
  const base: Prisma.ScanEventWhereInput = { tenantId, scanTime: { gte: dayStart }, employee };

  // What the rows cover: that, narrowed by whichever counter is picked. A
  // direction always comes with its reader, because every counter has one.
  const narrow: Prisma.ScanEventWhereInput[] = [base];
  if (input.rejected) narrow.push({ stream: "TIME_CLOCK", outcome: { in: [...REJECTED] } });
  else if (input.stream) {
    narrow.push({ stream: input.stream });
    if (input.direction) narrow.push(directionWhere(input.stream, input.direction));
  }
  const filtered: Prisma.ScanEventWhereInput = { AND: narrow };

  const since = input.since ? new Date(input.since) : null;
  const before = input.before ? { at: new Date(input.before.at), id: input.before.id } : null;
  const limit = since ? MAX_NEW : Math.min(Math.max(input.limit ?? PAGE, 1), MAX_PAGE);

  const rowWhere: Prisma.ScanEventWhereInput = since
    ? { AND: [filtered, { createdAt: { gt: since } }] }
    : before
      ? { AND: [filtered, { OR: [{ scanTime: { lt: before.at } }, { scanTime: before.at, id: { lt: before.id } }] }] }
      : filtered;

  const [rows, byStream, rejected, people, newest] = await Promise.all([
    db.scanEvent.findMany({
      where: rowWhere,
      orderBy: [{ scanTime: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        scanTime: true,
        stream: true,
        direction: true,
        directionSource: true,
        timecardPunchType: true,
        deviceName: true,
        outcome: true,
        rejectionReason: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            user: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
    }),
    db.scanEvent.groupBy({
      by: ["stream", "direction", "timecardPunchType"],
      where: base,
      _count: { _all: true },
    }),
    db.scanEvent.count({ where: { ...base, stream: "TIME_CLOCK", outcome: { in: [...REJECTED] } } }),
    db.scanEvent.groupBy({ by: ["employeeId"], where: base }),
    db.scanEvent.aggregate({ where: base, _max: { createdAt: true } }),
  ]);

  // A handful of groups, folded here only to apply the time clock rule above.
  const count = (stream: string, direction?: string) =>
    byStream
      .filter(
        (g) =>
          g.stream === stream &&
          (!direction ||
            (stream === "TIME_CLOCK" ? clockDirection(g.timecardPunchType, g.direction) : g.direction) === direction),
      )
      .reduce((n, g) => n + g._count._all, 0);

  const more = rows.length > limit;
  const page: ScanLogRow[] = rows.slice(0, limit).flatMap((s) =>
    s.employee
      ? [
          {
            id: s.id,
            at: s.scanTime.toISOString(),
            stream: s.stream,
            direction: s.stream === "TIME_CLOCK" ? clockDirection(s.timecardPunchType, s.direction) : s.direction,
            punchType: s.timecardPunchType,
            device: s.deviceName,
            automatic: s.directionSource === "AUTO_CLOSE" || s.directionSource === "SEEDED",
            reread: s.directionSource === "REREAD",
            rejected: s.stream === "TIME_CLOCK" && (REJECTED as readonly string[]).includes(s.outcome),
            rejectionReason: s.rejectionReason,
            photoUrl: null,
            person: {
              id: s.employee.id,
              name: s.employee.user?.name?.trim() || `Employee ${s.employee.employeeCode}`,
              employeeCode: s.employee.employeeCode,
              department: s.employee.department?.name ?? null,
              photoUrl: null,
            },
          },
        ]
      : [],
  );

  return {
    day,
    rows: page,
    hasMore: more,
    summary: {
      gateIn: count("SECURITY", "IN"),
      gateOut: count("SECURITY", "OUT"),
      gateTotal: count("SECURITY"),
      clockIn: count("TIME_CLOCK", "IN"),
      clockOut: count("TIME_CLOCK", "OUT"),
      clockTotal: count("TIME_CLOCK"),
      rejected,
      people: people.filter((p) => p.employeeId).length,
    },
    watermark: newest._max.createdAt?.toISOString() ?? null,
  };
}
