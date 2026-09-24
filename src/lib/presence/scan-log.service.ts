import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { snapToLocalTime } from "@/lib/utils/date";
import { addDays, clampDay } from "./days";
import { localDateString } from "./on-site.service";
import { photoUrls } from "./photos";
import { NOT_COUNTED_OUTCOMES } from "./scan-rules";
import { scansHere, siteScope } from "./site-scope";
import { LONG_BREAK_MIN } from "./movements";
import type { ScanContext, ScanLogPage, ScanLogQuery, ScanLogRow } from "./types";

/**
 * Every reader event at one site on one day, today unless asked, from both the security gate and the
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
 * <p>Scoped by the building the scan was made at, like the board (see
 * site-scope.ts). A badge that matches nobody has no person, and is not in
 * this log.
 */

const REJECTED = NOT_COUNTED_OUTCOMES;
const SYSTEM = ["AUTO_CLOSE", "SEEDED"];

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
  const today = localDateString(new Date(), timezone);
  const day = clampDay(input.day, today) ?? today;
  const dayStart = snapToLocalTime("00:00", day, timezone);
  const dayEnd = snapToLocalTime("00:00", addDays(day, 1), timezone);

  const scope = await siteScope(tenantId, siteId);
  const q = input.q?.trim() || null;
  const employee: Prisma.EmployeeWhereInput = {
    tenantId,
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
  const base: Prisma.ScanEventWhereInput = {
    tenantId,
    scanTime: { gte: dayStart, lt: dayEnd },
    employee,
    AND: [scansHere(scope)],
  };

  // The scans that never counted: refused by the timecard, or a reader's
  // repeat of the same badge. Hidden unless "Not counted" is picked.
  const notCounted: Prisma.ScanEventWhereInput = {
    OR: [{ stream: "TIME_CLOCK", outcome: { in: [...REJECTED] } }, { directionSource: "REREAD" }],
  };
  // Every total counts real scans only: not those, and not the rows the
  // system wrote overnight, which are shown but are nobody's scan.
  const counted: Prisma.ScanEventWhereInput = {
    AND: [base, { NOT: notCounted }, { directionSource: { notIn: SYSTEM as never } }],
  };

  // A real entry through the gate, and a real clock in (not a return from a
  // meal): the two kinds a person is counted once for.
  const gateIn: Prisma.ScanEventWhereInput = { stream: "SECURITY", direction: "IN" };
  const clockIn: Prisma.ScanEventWhereInput = {
    stream: "TIME_CLOCK",
    OR: [{ timecardPunchType: "CLOCK_IN" }, { timecardPunchType: null, direction: "IN" }],
  };

  // Each person's first scan of that kind, for "first entry" and "first clock
  // in". One site and one day, so a few thousand rows at most.
  // What every counted scan that day means next to the one before it, for
  // the row text, and for the gate scans that have no partner.
  const contexts = await scanContexts(counted);
  const missedIds = [...contexts].filter(([, c]) => c.kind === "reentry" || c.kind === "reexit").map(([id]) => id);

  const firstIds = input.first
    ? await db.scanEvent
        .findMany({
          where: { AND: [counted, input.first === "gate" ? gateIn : clockIn] },
          orderBy: [{ scanTime: "asc" }, { id: "asc" }],
          select: { id: true, employeeId: true },
        })
        .then((rows) => {
          const seenPeople = new Set<string>();
          const ids: string[] = [];
          for (const r of rows) {
            if (!r.employeeId || seenPeople.has(r.employeeId)) continue;
            seenPeople.add(r.employeeId);
            ids.push(r.id);
          }
          return ids;
        })
    : null;

  // What the rows cover: that, narrowed by whichever counter is picked. A
  // direction always comes with its reader, because every counter has one.
  const narrow: Prisma.ScanEventWhereInput[] = [base];
  if (input.rejected) narrow.push(notCounted);
  else if (input.missed) {
    narrow.push({ NOT: notCounted }, { id: { in: missedIds } });
  } else if (firstIds) {
    narrow.push({ NOT: notCounted }, { id: { in: firstIds } });
  } else {
    narrow.push({ NOT: notCounted });
    if (input.stream) {
      narrow.push({ stream: input.stream });
      if (input.direction) narrow.push(directionWhere(input.stream, input.direction));
    }
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

  const [rows, byStream, rejected, autoClosed, people, newest, peopleIn, peopleClockedIn, clockAutoClosed] = await Promise.all([
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
            barcode: true,
            wmsId: true,
            user: { select: { name: true } },
            jobTitle: true,
            department: { select: { name: true } },
            site: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.scanEvent.groupBy({
      by: ["stream", "direction", "timecardPunchType"],
      where: counted,
      _count: { _all: true },
    }),
    db.scanEvent.count({ where: { AND: [base, notCounted] } }),
    db.scanEvent.count({ where: { ...base, stream: "SECURITY", directionSource: "AUTO_CLOSE" } }),
    db.scanEvent.groupBy({ by: ["employeeId"], where: counted }),
    db.scanEvent.aggregate({ where: base, _max: { createdAt: true } }),
    db.scanEvent.groupBy({ by: ["employeeId"], where: { AND: [counted, gateIn] } }),
    db.scanEvent.groupBy({ by: ["employeeId"], where: { AND: [counted, clockIn] } }),
    db.scanEvent.count({ where: { ...base, stream: "TIME_CLOCK", directionSource: "AUTO_CLOSE" } }),
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
  const seen = new Map<string, { id: string; barcode: string | null; wmsId: string | null; employeeCode: string }>();
  for (const r of rows.slice(0, limit)) if (r.employee) seen.set(r.employee.id, r.employee);
  const photos = await photoUrls(tenantId, [...seen.values()]);
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
            context: contexts.get(s.id) ?? null,
            photoUrl: null,
            person: {
              id: s.employee.id,
              name: s.employee.user?.name?.trim() || `Employee ${s.employee.employeeCode}`,
              employeeCode: s.employee.employeeCode,
              department: s.employee.department?.name ?? null,
              jobTitle: s.employee.jobTitle?.trim() || null,
              homeSite: s.employee.site && s.employee.site.id !== siteId ? s.employee.site.name : null,
              photoUrl: photos.get(s.employee.id) ?? null,
            },
          },
        ]
      : [],
  );

  return {
    day,
    today,
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
      gateAutoClosed: autoClosed,
      clockAutoClosed,
      people: people.filter((p) => p.employeeId).length,
      peopleIn: peopleIn.filter((p) => p.employeeId).length,
      peopleClockedIn: peopleClockedIn.filter((p) => p.employeeId).length,
      missedGate: missedIds.length,
    },
    watermark: newest._max.createdAt?.toISOString() ?? null,
  };
}

/* ── What each scan means next to the one before it ──────────────────────── */

/** Two reads of the same direction this close together are one pass through the gate. */
const SAME_PASS_MS = 5 * 60 * 1000;

/**
 * For every counted scan the page shows, the step it completes: leaving
 * after so long inside, coming back after so long out, clocking out after so
 * long on the clock, returning from a meal of so long. Read from the same
 * counted scans the totals use, for the people on the page and this day
 * only, in one query.
 */
async function scanContexts(counted: Prisma.ScanEventWhereInput): Promise<Map<string, ScanContext>> {
  const out = new Map<string, ScanContext>();
  const all = await db.scanEvent.findMany({
    where: counted,
    orderBy: [{ scanTime: "asc" }, { id: "asc" }],
    select: { id: true, employeeId: true, scanTime: true, stream: true, direction: true, timecardPunchType: true },
  });
  const mins = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60000));
  const byPerson = new Map<string, typeof all>();
  for (const s of all) if (s.employeeId) (byPerson.get(s.employeeId) ?? byPerson.set(s.employeeId, []).get(s.employeeId)!).push(s);

  for (const scans of byPerson.values()) {
    let lastIn: Date | null = null;
    let lastOut: Date | null = null;
    let lastGate: "IN" | "OUT" | null = null;
    let workFrom: Date | null = null;
    let offFrom: Date | null = null;
    let pause: { at: Date; kind: "meal" | "break" } | null = null;
    let sawClockIn = false;
    for (const s of scans) {
      if (s.stream === "SECURITY") {
        // A second read within a few minutes is the same pass through the
        // gate, not a missed scan; anything later has lost its partner.
        if (s.direction === "IN") {
          if (lastGate === "IN" && lastIn && s.scanTime.getTime() - lastIn.getTime() > SAME_PASS_MS) {
            out.set(s.id, { kind: "reentry", minutes: null, long: true, since: lastIn.toISOString() });
          } else if (lastGate !== "IN") {
            out.set(s.id, lastOut ? { kind: "out", minutes: mins(lastOut, s.scanTime), long: false } : { kind: "firstIn", minutes: null, long: false });
          }
          if (lastGate !== "IN") lastIn = s.scanTime;
          lastOut = null;
          lastGate = "IN";
        } else if (s.direction === "OUT") {
          if (lastGate === "OUT" && lastOut && s.scanTime.getTime() - lastOut.getTime() > SAME_PASS_MS) {
            out.set(s.id, { kind: "reexit", minutes: null, long: true, since: lastOut.toISOString() });
          } else if (lastIn && lastGate === "IN") {
            out.set(s.id, { kind: "inside", minutes: mins(lastIn, s.scanTime), long: false });
          }
          if (lastGate !== "OUT") lastOut = s.scanTime;
          lastGate = "OUT";
        }
        continue;
      }
      const type = s.timecardPunchType ?? (s.direction === "IN" ? "CLOCK_IN" : s.direction === "OUT" ? "CLOCK_OUT" : null);
      if (type === "CLOCK_IN") {
        out.set(s.id, sawClockIn && offFrom ? { kind: "off", minutes: mins(offFrom, s.scanTime), long: false } : { kind: "firstClock", minutes: null, long: false });
        sawClockIn = true;
        workFrom = s.scanTime;
        offFrom = null;
        pause = null;
      } else if (type === "CLOCK_OUT") {
        if (workFrom) out.set(s.id, { kind: "worked", minutes: mins(workFrom, s.scanTime), long: false });
        workFrom = null;
        offFrom = s.scanTime;
      } else if (type === "MEAL_START" || type === "BREAK_START") {
        if (workFrom) out.set(s.id, { kind: "working", minutes: mins(workFrom, s.scanTime), long: false });
        workFrom = null;
        pause = { at: s.scanTime, kind: type === "MEAL_START" ? "meal" : "break" };
      } else if (type === "MEAL_END" || type === "BREAK_END") {
        if (pause) {
          const m = mins(pause.at, s.scanTime);
          out.set(s.id, { kind: pause.kind, minutes: m, long: m > LONG_BREAK_MIN });
        }
        pause = null;
        workFrom = s.scanTime;
      }
    }
  }
  return out;
}
