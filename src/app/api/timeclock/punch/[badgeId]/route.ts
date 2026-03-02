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
        // CA-style: check if employee already had a meal segment today
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ badgeId: string }> }
) {
  // 1. Authenticate via shared secret
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.TIMECLOCK_API_KEY;
  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return unauthorized();
  }

  // 2. Get badge ID from URL path
  const { badgeId } = await params;
  if (!badgeId) {
    return NextResponse.json(
      { success: false, error: "Badge ID is required in URL path" },
      { status: 400 }
    );
  }

  // 3. Parse and validate body
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

  const { ScanDateTime, DeviceName } = parsed.data;

  // 4. Look up employee by wmsId (badge QR code)
  const employee = await db.employee.findUnique({
    where: { wmsId: badgeId },
    include: { ruleSet: true },
  });

  if (!employee) {
    return NextResponse.json(
      { success: false, error: `Badge ID "${badgeId}" not found` },
      { status: 404 }
    );
  }

  if (!employee.isActive) {
    return NextResponse.json(
      { success: false, error: "Employee is inactive" },
      { status: 400 }
    );
  }

  // 5. Find open pay period
  const payPeriod = await findOpenPayPeriod();
  if (!payPeriod) {
    return NextResponse.json(
      { success: false, error: "No active pay period" },
      { status: 400 }
    );
  }

  // 6. Find or create timesheet
  const timesheet = await findOrCreateTimesheet(employee.id, payPeriod.id);
  if (timesheet.status === "LOCKED") {
    return NextResponse.json(
      { success: false, error: "Timesheet is locked for this pay period" },
      { status: 409 }
    );
  }

  // 7. Get current state and auto-detect punch type
  const stateBefore = await getCurrentPunchState(employee.id);
  const punchType = await detectPunchType(
    employee.id,
    timesheet.id,
    stateBefore,
    employee.ruleSet.autoDeductMeal
  );

  // 8. Validate state transition
  const transition = validateTransition(stateBefore, punchType);
  if (!transition.valid) {
    return NextResponse.json(
      { success: false, error: transition.error },
      { status: 409 }
    );
  }

  // 9. Parse scan time and apply rounding
  const punchTime = new Date(ScanDateTime);
  const roundedTime = applyRounding(punchTime, employee.ruleSet.punchRoundingMinutes);

  // 10. Create punch + audit log in transaction
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

    // 11. Rebuild segments
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
