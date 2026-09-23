import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { computeRoundedTime, computeShiftExpiry } from "@/lib/utils/date";
import { getCurrentPunchState, findOpenPayPeriod, saveRejectedPunch } from "@/lib/utils/punch-helpers";
import { validateTransition } from "@/lib/state-machines/punch-state";
import { timeclockScanSchema } from "@/lib/validators/punch.schema";
import { recordScanEvent, resolveScanOutcome } from "@/lib/services/scan-event.service";
import { findEmployeeByBadge } from "@/lib/utils/badge-lookup";
import type { PunchType, PunchState } from "@prisma/client";

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

/**
 * Parse a naive datetime string (no timezone offset) as if it were in the
 * given IANA timezone (e.g. "America/New_York"), then return a UTC Date.
 */
function parseLocalDateTime(naiveDateStr: string, timezone: string): Date {
  const asUtc = new Date(naiveDateStr.replace(" ", "T") + "Z");
  if (isNaN(asUtc.getTime())) {
    throw new Error(`Invalid ScanDateTime: ${naiveDateStr}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(asUtc);

  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  const localYear = get("year");
  const localMonth = get("month") - 1;
  const localDay = get("day");
  let localHour = get("hour");
  const localMinute = get("minute");
  const localSecond = get("second");
  if (localHour === 24) localHour = 0;

  const localAsUtcMs = Date.UTC(localYear, localMonth, localDay, localHour, localMinute, localSecond);
  const offsetMs = asUtc.getTime() - localAsUtcMs;

  return new Date(asUtc.getTime() + offsetMs);
}

/**
 * Auto-determine punch type from the current state and the employee's rule set.
 *
 * NJ-style (autoDeductMeal = true):  CLOCK_IN / CLOCK_OUT  (2 punches/day)
 * CA-style (autoDeductMeal = false): CLOCK_IN / MEAL_START / MEAL_END / CLOCK_OUT  (4 punches/day)
 */
async function detectPunchType(
  employeeId: string,
  timesheetId: string,
  currentState: PunchState,
  autoDeductMeal: boolean
): Promise<PunchType> {
  switch (currentState) {
    case "OUT":
      return "CLOCK_IN";
    case "MEAL":
      return "MEAL_END";
    case "BREAK":
      return "BREAK_END";
    case "WORK": {
      if (!autoDeductMeal) {
        const mealToday = await db.punch.findFirst({
          where: {
            employeeId,
            timesheetId,
            punchType: "MEAL_START",
            isApproved: true,
            correctedById: null,
          },
        });
        if (!mealToday) return "MEAL_START";
      }
      return "CLOCK_OUT";
    }
  }
}

/**
 * How close together two punches may be before the second is refused.
 *
 * Five minutes, matching the legacy rule this mirrors —
 * `EmployeesController.IsDuplicateScan`, which returns true on
 * `difference.TotalMinutes < 5`. Kept identical on purpose: an employee should
 * get the same answer whichever system is doing the deciding, and the point of
 * holding the rule here is to be able to stop asking Oracle for it.
 */
const PUNCH_MIN_GAP_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  // 1. Authenticate via shared secret
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.TIMECLOCK_API_KEY;
  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return unauthorized();
  }

  // 2. Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = timeclockScanSchema.safeParse(body);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => i.message).join("; ");
    return NextResponse.json(
      { success: false, error: msgs },
      { status: 400 }
    );
  }

  const { EmployeeCode, ScanDateTime, DeviceName, Warehouse, AppVersion } = parsed.data;

  // 3. Look up the employee by either badge form — the 6-digit employee
  //    number or the 10-digit barcode. See badge-lookup for why both exist
  //    and what matching only one of them used to cost.
  const employee = await findEmployeeByBadge(EmployeeCode);

  // 4. Parse the scan time. Needed before anything else now, because the
  //    tablet's transaction is written down before any timecard work happens.
  let punchTime: Date;
  try {
    punchTime = parseLocalDateTime(
      ScanDateTime,
      employee?.site.timezone ?? "America/New_York"
    );
  } catch {
    return NextResponse.json(
      { success: false, error: `Invalid ScanDateTime: ${ScanDateTime}` },
      { status: 400 }
    );
  }

  // 5. Record the tablet's transaction BEFORE the pipeline below runs.
  //
  //    This is what makes scan_events an independent record rather than a copy
  //    of this pipeline's conclusions. Every exit path below reports back what
  //    happened, so a scan that gets refused, dropped or crashed on still
  //    leaves a row — and those are exactly the scans worth alerting on,
  //    because by definition they leave no trace in `punches`.
  //
  //    Never allowed to fail the punch: a reporting write must not cost an
  //    employee a punch this pipeline would otherwise have accepted.
  let scanEventId: string | null = null;
  try {
    const recorded = await recordScanEvent({
      badgeCode: EmployeeCode,
      stream: "TIME_CLOCK",
      scanTime: punchTime,
      deviceName: DeviceName ?? null,
      appVersion: AppVersion ?? null,
      site: Warehouse == null ? null : String(Warehouse),
    });
    scanEventId = recorded.id;

    // 5a. Idempotency. The kiosk retries a post until the server acknowledges
    //     it, so a response lost on the way back arrives here a second time.
    //     Replaying it would create a SECOND punch — and because the employee
    //     is now clocked in, the state machine would classify that one as a
    //     clock OUT, silently ending their shift. One physical scan must
    //     produce at most one punch, and (badge, stream, scanTime) is what
    //     identifies the physical scan.
    if (recorded.duplicate && recorded.punchId) {
      return NextResponse.json({
        success: true,
        punchId: recorded.punchId,
        punchType: recorded.timecardPunchType,
        stateAfter: recorded.timecardStateAfter,
        duplicate: true,
      });
    }
  } catch (err) {
    console.error("scan_events: failed to record scan for badge", EmployeeCode, err);
  }

  /** Reports this pipeline's verdict back onto the scan row. Never throws. */
  type Settle = Parameters<typeof resolveScanOutcome>[1];
  const settle = async (outcome: Settle["outcome"], extra: Omit<Settle, "outcome"> = {}) => {
    if (scanEventId) await resolveScanOutcome(scanEventId, { outcome, ...extra });
  };

  if (!employee) {
    const error = `Badge ID "${EmployeeCode}" not found`;
    await settle("NO_EMPLOYEE", { rejectionReason: error });
    return NextResponse.json({ success: false, error }, { status: 404 });
  }

  if (!employee.isActive) {
    await settle("PUNCH_REJECTED", { rejectionReason: "Employee is inactive" });
    return NextResponse.json(
      { success: false, error: "Employee is inactive" },
      { status: 400 }
    );
  }

  // 5b. Too soon after the last punch.
  //
  //     Oracle refuses a punch inside five minutes of the previous one, and
  //     that rule is presently the only thing keeping a reader that fires twice
  //     from putting a spurious pair on a timecard. CloudTime's REREAD rule
  //     covers both streams in principle but has never once fired on this one —
  //     0 in the 7 days to 2026-09-21, against 89 of 89 caught at the gate the
  //     same day — so it cannot be leaned on here.
  //
  //     Holding the rule on this side changes nothing for anybody today: the
  //     kiosk still shows Oracle's verdict, and Oracle refuses these anyway. It
  //     does two things. It keeps CloudTime's own timecard free of the pairs
  //     Oracle rejects — 40 such pairs across 37 people in those 7 days, 26 of
  //     which became punches here that Oracle does not have — and it is the
  //     precondition for the kiosk ever showing this verdict without waiting on
  //     a call to Oracle, which is what the gate already stopped doing.
  //
  //     The scan is still recorded. Only the punch is refused, so the attempt
  //     stays visible in scan_events as PUNCH_REJECTED rather than vanishing.
  //     No `saveRejectedPunch` row: this is a repeat of a punch that already
  //     exists, not an attempt that failed a policy worth a timecard entry.
  const tooSoon = await db.punch.findFirst({
    where: {
      employeeId: employee.id,
      correctedById: null,
      // Only a previous KIOSK punch counts. A SYSTEM or MANUAL punch is not
      // "you just scanned" -- it is the auto clock-out job or a supervisor
      // correction -- and must never block a real scan. Measured over the 14
      // days to 2026-09-21: without this clause the rule refuses 226 punches,
      // 73 of them a genuine kiosk CLOCK_IN landing within five minutes of the
      // auto clock-out that had just closed the person's previous shift. With
      // it, 57 -- the kiosk-following-kiosk pairs the rule is actually for.
      source: "KIOSK",
      punchTime: { gte: new Date(punchTime.getTime() - PUNCH_MIN_GAP_MS), lt: punchTime },
    },
    orderBy: { punchTime: "desc" },
    select: { punchTime: true },
  });
  if (tooSoon) {
    const error = "Scanned again too quickly, please wait to prevent duplicates";
    await settle("PUNCH_REJECTED", { rejectionReason: error });
    // 200, not 409, and this is not cosmetic. The kiosk queue marks a row
    // synced on HTTP success and on any error deliberately leaves it in the
    // backlog for the next sweep -- "the server treats a repeat of the same
    // scan as the same punch, so a retry cannot double it". That reasoning
    // holds for a transient failure and not for a refusal, which will answer
    // the same way forever. A 4xx here would put every refused punch into a
    // retry loop that no sweep can ever clear, on every tablet in the field
    // including the ones that will never be updated again.
    //
    // So a decision the client can do nothing about is reported as a delivered
    // scan that produced no punch. Same shape the idempotency branch above
    // already uses.
    return NextResponse.json({
      success: true,
      punchId: null,
      /// Distinguishes "wait a moment" from a refusal waiting cannot fix, so a
      /// kiosk can say which without parsing the message. Nothing reads this
      /// yet; it is what the screen would show once the kiosk stops waiting on
      /// Oracle for this verdict.
      tooSoon: true,
      error,
      lastPunchAt: tooSoon.punchTime.toISOString(),
    });
  }

  // 6. Find open pay period
  const payPeriod = await findOpenPayPeriod(employee.tenantId, employee.ruleSetId);
  if (!payPeriod) {
    await saveRejectedPunch({ employeeId: employee.id, timesheetId: null, punchType: "CLOCK_IN", source: "KIOSK", stateBefore: "OUT", rejectionReason: "No active pay period" });
    await settle("PUNCH_REJECTED", { rejectionReason: "No active pay period" });
    return NextResponse.json(
      { success: false, error: "No active pay period" },
      { status: 400 }
    );
  }

  // 7. Find or create timesheet + get current state
  const timesheet = await findOrCreateTimesheet(employee.id, payPeriod.id);
  let stateBefore = await getCurrentPunchState(employee.id);

  // Workday expansion: if the employee is still clocked in from a previous shift,
  // either re-route the punch to the old timesheet (within the window) or, when
  // the window has passed AND the open punch is from an earlier day, reset state
  // to OUT so this tap becomes a CLOCK_IN. Same-day is never reset — see below.
  //
  // This also acts as a safety net when the state-reset cron runs late: without
  // the SYSTEM punch in the DB yet, getCurrentPunchState returns WORK, and the
  // next morning's clock-in would be misclassified as CLOCK_OUT. The expiry
  // check below catches that case and overrides the state to OUT.
  let activeTimesheetId = timesheet.id;
  let activeTimesheetStatus = timesheet.status;
  if (stateBefore === "WORK" && employee.ruleSet.workdayExpansionEnabled) {
    const lastOpenPunch = await db.punch.findFirst({
      where: { employeeId: employee.id, stateAfter: "WORK", correctedById: null },
      orderBy: { punchTime: "desc" },
      select: { punchTime: true, timesheetId: true },
    });

    if (lastOpenPunch?.timesheetId) {
      const tz = employee.site.timezone;

      if (employee.ruleSet.workdayExpansionUseShiftDef && employee.shift) {
        // Shift-based expiry: shift_end + expansion_window_minutes
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(lastOpenPunch.punchTime);
        const { expiryUtc } = computeShiftExpiry(
          employee.shift,
          localDate,
          employee.ruleSet.workdayExpansionAfterMinutes,
          tz,
        );

        if (punchTime <= expiryUtc) {
          // Within the expansion window — route to the old timesheet.
          const oldTimesheet = await db.timesheet.findUnique({
            where: { id: lastOpenPunch.timesheetId },
            select: { id: true, status: true },
          });
          if (
            oldTimesheet &&
            oldTimesheet.status !== "LOCKED" &&
            oldTimesheet.status !== "PAYROLL_APPROVED"
          ) {
            activeTimesheetId = oldTimesheet.id;
            activeTimesheetStatus = oldTimesheet.status;
          }
        } else {
          // Outside the expansion window. Whether that means "the previous
          // shift is over" depends on which DAY the open punch is from.
          //
          // From an earlier local day: this is what the window was built for.
          // Somebody forgot to clock out yesterday and is arriving now, so
          // override to OUT and let this tap be a CLOCK_IN.
          //
          // From TODAY: this is somebody working late — past scheduled end plus
          // the window — and this tap is their clock-out. Flipping it turned 34
          // real clock-outs into CLOCK_INs on 2026-09-22 (25 at NJ3, 5 at
          // NJ299, 4 at GA), every one past their shift's end time, and showed
          // "Clock-in" on the tablet to people walking out. Overtime is a long
          // day, not an expired shift, so the state stays WORK.
          const thisDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(punchTime);
          if (localDate !== thisDay) {
            stateBefore = "OUT";
          }
        }
      } else {
        // No shift schedule defined (calendar-day mode or no shift assigned).
        // Fallback: if the last WORK punch was on a previous calendar day the
        // expansion window has certainly closed — treat this as a new CLOCK_IN.
        const lastPunchDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(lastOpenPunch.punchTime);
        const currentDay   = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(punchTime);
        if (lastPunchDay !== currentDay) {
          stateBefore = "OUT";
        }
      }
    }
  }

  if (activeTimesheetStatus === "LOCKED") {
    await saveRejectedPunch({ employeeId: employee.id, timesheetId: activeTimesheetId, punchType: "CLOCK_IN", source: "KIOSK", stateBefore, rejectionReason: "Timesheet is locked for this pay period" });
    await settle("PUNCH_REJECTED", { rejectionReason: "Timesheet is locked for this pay period" });
    return NextResponse.json(
      { success: false, error: "Timesheet is locked for this pay period" },
      { status: 409 }
    );
  }

  // 7. Auto-detect punch type and validate transition
  const punchType = await detectPunchType(
    employee.id,
    activeTimesheetId,
    stateBefore,
    employee.ruleSet.autoDeductMeal
  );

  // 8. Validate state transition
  const transition = validateTransition(stateBefore, punchType);
  if (!transition.valid) {
    await saveRejectedPunch({ employeeId: employee.id, timesheetId: activeTimesheetId, punchType, source: "KIOSK", stateBefore, rejectionReason: transition.error ?? "Invalid state transition" });
    await settle("PUNCH_REJECTED", {
      punchType,
      rejectionReason: transition.error ?? "Invalid state transition",
    });
    return NextResponse.json(
      { success: false, error: transition.error },
      { status: 409 }
    );
  }

  const roundedTime = computeRoundedTime(punchTime, punchType, employee.ruleSet, employee.shift, employee.site.timezone);

  // 9. Create punch + audit log in transaction
  try {
    const punch = await db.$transaction(async (tx) => {
      const p = await tx.punch.create({
        data: {
          employeeId: employee.id,
          timesheetId: activeTimesheetId,
          punchType,
          punchTime,
          roundedTime,
          source: "KIOSK",
          stateBefore,
          stateAfter: transition.newState,
          isApproved: true,
          note: DeviceName ? `Device: ${DeviceName}` : null,
        },
      });
      await writeAuditLog({
        actorId: employee.id,
        action: "PUNCH_RECORDED",
        entityType: "PUNCH",
        entityId: p.id,
        changes: {
          after: {
            punchType,
            source: "KIOSK",
            stateAfter: transition.newState,
            device: DeviceName,
          },
        },
      });
      return p;
    });

    // 10. Rebuild segments
    await rebuildSegments(punch.timesheetId!, employee.ruleSet);

    // 12. Report the verdict back onto the tablet's transaction record.
    //     The scan row keeps its own independently resolved direction; what is
    //     written here is what THIS pipeline concluded, so the two can be
    //     compared afterwards by detect-scan-discrepancies.
    await settle("PUNCH_RECORDED", {
      punchId: punch.id,
      punchType,
      stateAfter: transition.newState,
    });

    return NextResponse.json({
      success: true,
      punchId: punch.id,
      punchType,
      stateAfter: transition.newState,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    await settle("ERROR", { rejectionReason: message });
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
