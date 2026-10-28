import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { findScanDiscrepancies } from "@/lib/services/scan-event.service";
import { findOpenPayPeriod, TOO_SOON_REJECTION } from "@/lib/utils/punch-helpers";
import { CLIENT_TIME_CLOCK_REJECTION } from "@/lib/utils/client-badge";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { personTimeZone } from "@/lib/utils/person-time-zone";

/**
 * Compares what the tablets recorded against what the timecards say, and
 * raises a SCAN_DISCREPANCY exception for anything that does not line up.
 *
 * <b>Why this is not just another punch check.</b> Every other exception type
 * is derived from punches, so none of them can see a punch that is simply
 * absent — there is nothing to derive from. This one starts from the tablets'
 * own transaction log, which is written before the timecard pipeline runs and
 * independently of it, so a scan that was refused, lost or misclassified still
 * has a row to be found.
 *
 * Runs over a closed window (yesterday and today by default, both in full).
 * A scan taken seconds ago is legitimately still unresolved, so the window
 * deliberately stops short of the last few minutes.
 */

/** Scans newer than this are still in flight and are not judged yet. */
const SETTLING_MINUTES = 15;
/** How far back to look. Overlaps deliberately so a late arrival is caught. */
const LOOKBACK_HOURS = 48;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const to = new Date(Date.now() - SETTLING_MINUTES * 60_000);
  const from = new Date(to.getTime() - LOOKBACK_HOURS * 3_600_000);

  const discrepancies = await findScanDiscrepancies(from, to);

  let raised = 0;
  let alreadyKnown = 0;
  let unattributable = 0;
  let repeats = 0;
  let clientScans = 0;
  const errors: string[] = [];

  for (const d of discrepancies) {
    // A scan whose badge matches nobody has no timesheet to hang an exception
    // on. It is still a real finding, so it is counted and returned — it just
    // cannot enter the supervisor workflow, which is keyed on timesheets.
    if (!d.employeeId) {
      unattributable += 1;
      continue;
    }

    // A repeat scan the clock refused for coming too soon after the last one is
    // the duplicate rule doing its job: the punch it repeats is on the
    // timecard. It stays in the Scan Discrepancies report, but raises no
    // exception for HR to clear.
    if (d.kind === "REJECTED" && d.rejectionReason === TOO_SOON_REJECTION) {
      repeats += 1;
      continue;
    }

    // Likewise a client's badge refused at a time clock (client-badge.ts):
    // the rule working, and a client keeps no timecard to raise one on.
    if (d.kind === "REJECTED" && d.rejectionReason === CLIENT_TIME_CLOCK_REJECTION) {
      clientScans += 1;
      continue;
    }

    try {
      const employee = await db.employee.findUnique({
        where: { id: d.employeeId },
        select: { id: true, tenantId: true, ruleSetId: true, isActive: true, timeZone: true, site: { select: { timezone: true } } },
      });
      if (!employee) {
        unattributable += 1;
        continue;
      }
      // An inactive person's timecards are closed: no exception on them, and
      // no timecard made to hold one.
      if (!employee.isActive) continue;

      // The period holding the scan's day, not today's: the sweep looks back.
      const payPeriod = await findOpenPayPeriod(employee.tenantId, employee.ruleSetId, {
        at: d.scanTime,
        timezone: personTimeZone(employee),
      });
      if (!payPeriod) {
        unattributable += 1;
        continue;
      }

      const timesheet = await findOrCreateTimesheet(employee.id, payPeriod.id);

      // One exception per scan, not one per sweep — this runs on a schedule
      // and the windows overlap on purpose.
      const existing = await db.exception.findFirst({
        where: {
          timesheetId: timesheet.id,
          exceptionType: "SCAN_DISCREPANCY",
          occurredAt: d.scanTime,
        },
        select: { id: true },
      });

      if (existing) {
        alreadyKnown += 1;
        continue;
      }

      // Raised closed, as a record on the person that a scan went wrong. What
      // it costs the timecard is already an open exception HR works from: the
      // missed punch, or the absence, of that day. Left open, each one was a
      // second item to resolve by hand for the same problem, and stayed open
      // after the punch was fixed.
      await db.exception.create({
        data: {
          timesheetId: timesheet.id,
          exceptionType: "SCAN_DISCREPANCY",
          description: `[${d.kind}] ${d.description}`,
          occurredAt: d.scanTime,
          resolvedAt: new Date(),
          resolution: "Closed automatically: kept as a record of the scan. The day's missed punch or absence exception is where it is worked.",
        },
      });
      raised += 1;
    } catch (err) {
      errors.push(
        `${d.scanEventId}: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  const byKind = discrepancies.reduce<Record<string, number>>((acc, d) => {
    acc[d.kind] = (acc[d.kind] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    window: { from: from.toISOString(), to: to.toISOString() },
    found: discrepancies.length,
    byKind,
    raised,
    alreadyKnown,
    unattributable,
    skippedRepeatScans: repeats,
    skippedClientScans: clientScans,
    errors: errors.slice(0, 20),
  });
}
