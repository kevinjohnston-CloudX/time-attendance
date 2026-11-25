import "server-only";
import { db } from "@/lib/db";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import { NO_HOURS, missedPunchDays, timecardHours, type HoursLine, type TimecardHours } from "./timecard-hours";

/**
 * Hours for many timecards at once, counted from their lines the way the
 * timecard page counts them ({@link timecardHours}), never from the saved
 * totals.
 *
 * <p>Summed in the database: one row per timecard, day and kind of line, not
 * every line, so a period of 400 people stays a few thousand small rows.
 *
 * <p>Takes ids the caller already read inside its own company and site scope.
 * It widens nothing: an id outside that scope only comes back with hours the
 * caller could not see named anyway, and callers only pass ids they listed.
 */
export async function hoursForTimesheets(timesheetIds: string[]): Promise<Map<string, TimecardHours>> {
  const out = new Map<string, TimecardHours>();
  if (timesheetIds.length === 0) return out;

  const [groups, exceptions, sheets] = await Promise.all([
    db.workSegment.groupBy({
      by: ["timesheetId", "segmentDate", "segmentType", "payBucket", "payBucketOverride", "payCodeId", "isPaid"],
      where: { timesheetId: { in: timesheetIds } },
      // Seconds, not the rounded minutes column: leave is kept to the
      // hundredth of an hour (lib/leave-time), and the timecard page and the
      // ADP file both count it exactly.
      _sum: { durationSeconds: true },
    }),
    db.exception.findMany({
      where: { timesheetId: { in: timesheetIds }, resolvedAt: null, exceptionType: "MISSING_PUNCH" },
      select: { timesheetId: true, exceptionType: true, occurredAt: true },
    }),
    db.timesheet.findMany({
      where: { id: { in: timesheetIds } },
      select: {
        id: true,
        employee: { select: { tenantId: true, timeZone: true, site: { select: { timezone: true } } } },
      },
    }),
  ]);

  // Which pay codes are set to Not paid, for the codes these lines carry.
  const codeIds = [...new Set(groups.map((g) => g.payCodeId).filter((id): id is string => !!id))];
  const tenants = [...new Set(sheets.map((s) => s.employee.tenantId))];
  const notPaidCodes = new Set(
    codeIds.length
      ? (await db.payCode.findMany({
          where: { id: { in: codeIds }, tenantId: { in: tenants }, isPaid: false },
          select: { id: true },
        })).map((c) => c.id)
      : [],
  );

  const linesBySheet = new Map<string, HoursLine[]>();
  for (const g of groups) {
    const list = linesBySheet.get(g.timesheetId) ?? [];
    list.push({
      segmentType: g.segmentType,
      payBucket: g.payBucket,
      payBucketOverride: g.payBucketOverride,
      isPaid: g.isPaid,
      payCodeIsPaid: g.payCodeId ? !notPaidCodes.has(g.payCodeId) : null,
      segmentDate: g.segmentDate,
      durationMinutes: (g._sum.durationSeconds ?? 0) / 60,
    });
    linesBySheet.set(g.timesheetId, list);
  }

  const exceptionsBySheet = new Map<string, { exceptionType: string; occurredAt: Date }[]>();
  for (const e of exceptions) {
    const list = exceptionsBySheet.get(e.timesheetId) ?? [];
    list.push(e);
    exceptionsBySheet.set(e.timesheetId, list);
  }

  for (const s of sheets) {
    const skip = missedPunchDays(exceptionsBySheet.get(s.id) ?? [], personTimeZone(s.employee));
    out.set(s.id, timecardHours(linesBySheet.get(s.id) ?? [], skip));
  }
  for (const id of timesheetIds) if (!out.has(id)) out.set(id, NO_HOURS);
  return out;
}
