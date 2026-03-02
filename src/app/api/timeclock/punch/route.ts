import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { applyRounding } from "@/lib/utils/date";
import { getCurrentPunchState, findOpenPayPeriod } from "@/lib/utils/punch-helpers";
import { validateTransition } from "@/lib/state-machines/punch-state";
import { timeclockScanSchema } from "@/lib/validators/punch.schema";
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

  const { EmployeeCode, ScanDateTime, DeviceName } = parsed.data;

  // 3. Look up employee by wmsId (badge QR code)
  const employee = await db.employee.findUnique({
    where: { wmsId: EmployeeCode },
    include: { ruleSet: true, site: true },
  });

  if (!employee) {
    return NextResponse.json(
      { success: false, error: `Badge ID "${EmployeeCode}" not found` },
      { status: 404 }
    );
  }

  if (!employee.isActive) {
    return NextResponse.json(
      { success: false, error: "Employee is inactive" },
      { status: 400 }
    );
  }

  // 4. Find open pay period
  const payPeriod = await findOpenPayPeriod(employee.tenantId);
  if (!payPeriod) {
    return NextResponse.json(
      { success: false, error: "No active pay period" },
      { status: 400 }
    );
  }

  // 5. Find or create timesheet
  const timesheet = await findOrCreateTimesheet(employee.id, payPeriod.id);
  if (timesheet.status === "LOCKED") {
    return NextResponse.json(
      { success: false, error: "Timesheet is locked for this pay period" },
      { status: 409 }
    );
  }

  // 6. Get current state and auto-detect punch type
  const stateBefore = await getCurrentPunchState(employee.id);
  const punchType = await detectPunchType(
    employee.id,
    timesheet.id,
    stateBefore,
    employee.ruleSet.autoDeductMeal
  );

  // 7. Validate state transition
  const transition = validateTransition(stateBefore, punchType);
  if (!transition.valid) {
    return NextResponse.json(
      { success: false, error: transition.error },
      { status: 409 }
    );
  }

  // 8. Parse scan time in the site's local timezone, then apply rounding
  let punchTime: Date;
  try {
    punchTime = parseLocalDateTime(ScanDateTime, employee.site.timezone);
  } catch {
    return NextResponse.json(
      { success: false, error: `Invalid ScanDateTime: ${ScanDateTime}` },
      { status: 400 }
    );
  }
  const roundedTime = applyRounding(punchTime, employee.ruleSet.punchRoundingMinutes);

  // 9. Create punch + audit log in transaction
  try {
    const punch = await db.$transaction(async (tx) => {
      const p = await tx.punch.create({
        data: {
          employeeId: employee.id,
          timesheetId: timesheet.id,
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
    await rebuildSegments(punch.timesheetId, employee.ruleSet);

    return NextResponse.json({
      success: true,
      punchId: punch.id,
      punchType,
      stateAfter: transition.newState,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
