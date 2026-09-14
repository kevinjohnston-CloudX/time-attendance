import { NextRequest, NextResponse } from "next/server";
import { PunchState } from "@prisma/client";
import { db } from "@/lib/db";
import { endOfDayInTz, computeShiftExpiry } from "@/lib/utils/date";

// Runs at 10:00 AM UTC daily (= 6:00 AM EDT) AND at 16:00 AM UTC (= 12:00 PM EDT).
// The second run catches night-shift workers whose expansion windows close mid-morning.
//
// Scans ALL active employees — regardless of timesheet approval status —
// and creates a SYSTEM unapproved CLOCK_OUT for any employee whose last punch
// leaves them in a non-OUT state once their workday expansion window has expired.
//
// With workday expansion enabled:  auto-close fires at shift end time once
//   (shift end + workdayExpansionAfterMinutes) has passed.
// Without expansion: auto-close fires at 23:59:59 local time (legacy behavior).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  // Conservative initial filter: any non-corrected, non-OUT punch before 4 AM UTC
  // covers "midnight EDT or earlier" in all US Eastern locations.
  const etTodayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const cutoffUtc = new Date(etTodayStr + "T04:00:00.000Z");

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
      const latestPunch = await db.punch.findFirst({
        where: { employeeId, correctedById: null },
        orderBy: { punchTime: "desc" },
        select: {
          id: true,
          punchTime: true,
          stateAfter: true,
          timesheetId: true,
          employee: {
            select: {
              site: { select: { timezone: true } },
              shift: { select: { startTime: true, endTime: true } },
              ruleSet: {
                select: {
                  workdayExpansionEnabled: true,
                  workdayExpansionUseShiftDef: true,
                  workdayExpansionAfterMinutes: true,
                },
              },
            },
          },
        },
      });

      if (!latestPunch || latestPunch.stateAfter === PunchState.OUT) {
        skipped++;
        continue;
      }

      const timezone = latestPunch.employee.site?.timezone ?? "America/New_York";
      const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(latestPunch.punchTime);
      const ruleSet = latestPunch.employee.ruleSet;
      const shift = latestPunch.employee.shift;

      let closeAtTime: Date;

      if (ruleSet?.workdayExpansionEnabled && ruleSet.workdayExpansionUseShiftDef && shift) {
        // Shift-aware expansion: close at shift end once the expansion window has expired.
        const { shiftEndUtc, expiryUtc } = computeShiftExpiry(
          shift,
          localDate,
          ruleSet.workdayExpansionAfterMinutes,
          timezone,
        );

        if (now < expiryUtc) {
          skipped++;
          continue; // expansion window still open — employee may punch out naturally
        }

        closeAtTime = shiftEndUtc;
      } else {
        // Legacy behavior: close at 23:59:59 local time of the punch date.
        const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
        if (localDate >= localToday) {
          skipped++;
          continue; // punch is from today — don't auto-close yet
        }
        closeAtTime = endOfDayInTz(localDate, timezone);
      }

      const alreadyExists = await db.punch.findFirst({
        where: {
          employeeId,
          source: "SYSTEM",
          punchType: "CLOCK_OUT",
          punchTime: closeAtTime,
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
          punchTime: closeAtTime,
          roundedTime: closeAtTime,
          source: "SYSTEM",
          stateBefore: latestPunch.stateAfter,
          stateAfter: PunchState.OUT,
          isApproved: false,
          note: "Auto-generated: employee still clocked in after workday expansion window — pending payroll correction",
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
