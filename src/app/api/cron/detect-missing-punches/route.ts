import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

// Runs at 10:05 AM UTC = ~6:05 AM EDT / 5:05 AM EST
// Scans all active timesheets in open pay periods and calls rebuildSegments,
// which will detect any day before today where an employee clocked in but
// never clocked out and create a MISSING_PUNCH exception.
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Include timesheets with ANY non-corrected punch — not just approved ones.
  // Requiring isApproved:true caused night-shift workers with unapproved KIOSK
  // punches to be skipped, leaving their state stuck as WORK across pay period boundaries.
  // Active employees only: an inactive one can no longer punch, so nothing on
  // their timecard changes overnight, and recalculating it only marked every
  // scheduled day since they left absent. An edit HR makes still recalculates
  // it straight away.
  const timesheets = await db.timesheet.findMany({
    where: {
      payPeriod: { status: "OPEN" },
      status: { notIn: ["LOCKED", "PAYROLL_APPROVED"] },
      employee: { isActive: true },
      punches: {
        some: {
          correctedById: null,
        },
      },
    },
    select: {
      id: true,
      employee: {
        select: {
          ruleSet: true,
        },
      },
    },
  });

  // A few at a time, and a failure is tried once more. All ~1,700 were started
  // at once, which ran the database out of connections: a recalculation that
  // failed part way left its lines rebuilt as all regular hours with the
  // overtime step never run (9 timecards on 10/12, Martha Chauca 48.7 regular
  // hours in a week), while the totals kept the overtime from the last good run.
  const failed: typeof timesheets = [];
  let processed = 0;
  for (let i = 0; i < timesheets.length; i += CONCURRENCY) {
    const batch = timesheets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((ts) => rebuildSegments(ts.id, ts.employee.ruleSet)));
    results.forEach((r, j) => (r.status === "fulfilled" ? processed++ : failed.push(batch[j])));
  }
  const errors: string[] = [];
  for (const ts of failed) {
    try {
      await rebuildSegments(ts.id, ts.employee.ruleSet);
      processed++;
    } catch (err) {
      errors.push(ts.id);
      console.error("detect-missing-punches: recalculation failed twice", ts.id, err);
    }
  }

  return NextResponse.json({ total: timesheets.length, processed, retried: failed.length, errors: errors.length });
}

/** Recalculations run side by side: enough to finish in time, few enough for the connection pool. */
const CONCURRENCY = 8;

export const maxDuration = 300;
