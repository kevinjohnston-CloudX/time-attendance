import { NextRequest, NextResponse } from "next/server";
import { PunchState } from "@prisma/client";
import { db } from "@/lib/db";
import { endOfDayInTz } from "@/lib/utils/date";

// Runs at 10:00 AM UTC daily (= 6:00 AM EDT), 5 min before detect-missing-punches.
// Scans ALL active employees — regardless of timesheet approval status —
// and creates a SYSTEM unapproved CLOCK_OUT at 23:59:59 local time for any
// employee whose last punch leaves them in a non-OUT state from a previous day.
//
// This catches night-shift workers and cross-period open clock-ins that the
// detect-missing-punches cron misses (it requires at least one approved punch).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Conservative cutoff: anything before 4 AM UTC is definitely "yesterday" in any
  // US Eastern timezone (midnight EDT=4AM UTC, midnight EST=5AM UTC).
  // Per-employee we do a precise local-date check using their site timezone.
  const now = new Date();
  const etTodayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  // 4 AM UTC = midnight EDT. Punches before this are from "yesterday or earlier" in ET.
  const cutoffUtc = new Date(etTodayStr + "T04:00:00.000Z");

  // Step 1: Find candidate employees — those with any non-corrected, non-OUT punch before cutoff.
  const candidates = await db.punch.groupBy({
    by: ["employeeId"],
    where: {
      stateAfter: { not: PunchState.OUT },
      correctedById: null,
      punchTime: { lt: cutoffUtc },
    },
  });

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const { employeeId } of candidates) {
    try {
      // Step 2: Get the employee's actual LATEST punch to verify they're still open.
      const latestPunch = await db.punch.findFirst({
        where: { employeeId, correctedById: null },
        orderBy: { punchTime: "desc" },
        select: {
          id: true,
          punchTime: true,
          stateAfter: true,
          timesheetId: true,
          employee: {
            select: { site: { select: { timezone: true } } },
          },
        },
      });

      if (!latestPunch || latestPunch.stateAfter === PunchState.OUT) {
        skipped++;
        continue; // already clocked out by a subsequent punch
      }

      const timezone = latestPunch.employee.site?.timezone ?? "America/New_York";
      const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(latestPunch.punchTime);
      const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);

      if (localDate >= localToday) {
        skipped++;
        continue; // punch happened today in their local timezone — don't auto-close yet
      }

      const eodTime = endOfDayInTz(localDate, timezone);

      // Check if a SYSTEM auto-out already exists for this employee at this exact time.
      const alreadyExists = await db.punch.findFirst({
        where: {
          employeeId,
          source: "SYSTEM",
          punchType: "CLOCK_OUT",
          punchTime: eodTime,
          correctedById: null,
        },
        select: { id: true },
      });

      if (alreadyExists) {
        skipped++;
        continue;
      }

      await db.punch.create({
        data: {
          employeeId,
          timesheetId: latestPunch.timesheetId,
          punchType: "CLOCK_OUT",
          punchTime: eodTime,
          roundedTime: eodTime,
          source: "SYSTEM",
          stateBefore: latestPunch.stateAfter,
          stateAfter: PunchState.OUT,
          isApproved: false,
          note: "Auto-generated: employee still clocked in at end of day — pending payroll correction",
        },
      });
      created++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({
    candidates: candidates.length,
    created,
    skipped,
    errors,
  });
}
