import { db } from "@/lib/db";
import { getCurrentPunchState } from "@/lib/utils/punch-helpers";
import { computeShiftExpiry } from "@/lib/utils/date";
import { dateFormat } from "@/lib/utils/date-format";
import { personTimeZone } from "@/lib/utils/person-time-zone";

/**
 * Whether a time clock scan by this person at `at` would clock them OUT.
 *
 * <p>The tablet check (api/timeclock/eligibility) asks this so a building's
 * "scan at security before the time clock" rule only ever stops a clock IN.
 * Someone who scans out at security and then walks to the time clock is
 * leaving: refusing them made a missing punch, never a safer building. From
 * Nov 23 to 25, 2026 at 5903 Nj that cost about 20 clock outs (ticket 81278,
 * Gabriel Benincasa, refused every evening).
 *
 * <p>It reads the same state the punch endpoint classifies a scan from
 * (api/timeclock/punch/route.ts, steps 7 and 8), and nothing else, so the two
 * agree on what the scan will be:
 * <ul>
 *   <li>Clocked out: the scan is a clock in.</li>
 *   <li>On a meal or a break: the scan ends it, which is coming back in, so it
 *       stays under the rule like a clock in.</li>
 *   <li>Clocked in: the scan is a clock out, unless the open punch is a
 *       forgotten one from an earlier day that the punch endpoint will treat
 *       as over (workday expansion), when the scan is a clock in.</li>
 * </ul>
 * Read only. It changes nothing about how a punch is classified.
 */
export async function nextScanClocksOut(
  employee: {
    id: string;
    timeZone: string | null;
    site: { timezone: string | null } | null;
    ruleSet: {
      workdayExpansionEnabled: boolean;
      workdayExpansionUseShiftDef: boolean;
      workdayExpansionAfterMinutes: number;
    } | null;
    shift: { startTime: string; endTime: string } | null;
  },
  at: Date,
): Promise<boolean> {
  const state = await getCurrentPunchState(employee.id);
  if (state !== "WORK") return false;

  const rules = employee.ruleSet;
  if (!rules?.workdayExpansionEnabled) return true;

  const open = await db.punch.findFirst({
    where: { employeeId: employee.id, stateAfter: "WORK", correctedById: null },
    orderBy: { punchTime: "desc" },
    select: { punchTime: true, timesheetId: true },
  });
  // The punch endpoint only re-reads an open punch filed on a timecard.
  if (!open?.timesheetId) return true;

  const tz = personTimeZone(employee);
  const day = (d: Date) => dateFormat("en-CA", { timeZone: tz }).format(d);
  const openedOn = day(open.punchTime);

  if (rules.workdayExpansionUseShiftDef && employee.shift) {
    const { expiryUtc } = computeShiftExpiry(employee.shift, openedOn, rules.workdayExpansionAfterMinutes, tz);
    // Inside the window: the shift is still going, so this ends it.
    if (at <= expiryUtc) return true;
  }
  // Past the window, or no shift to measure it by: an open punch from an
  // earlier day is a forgotten one, and this scan starts a new day. From
  // today, it is a long day ending.
  return openedOn === day(at);
}
