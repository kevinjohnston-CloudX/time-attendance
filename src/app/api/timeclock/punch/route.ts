import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { applyRounding } from "@/lib/utils/date";
import { getCurrentPunchState, findOpenPayPeriod } from "@/lib/utils/punch-helpers";
import { validateTransition } from "@/lib/state-machines/punch-state";
import { timeclockPunchSchema } from "@/lib/validators/punch.schema";

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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

  const parsed = timeclockPunchSchema.safeParse(body);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => i.message).join("; ");
    return NextResponse.json(
      { success: false, error: msgs },
      { status: 400 }
    );
  }

  const { employeeCode, punchType, punchTime: punchTimeStr, note } = parsed.data;

  // 3. Look up employee by code
  const employee = await db.employee.findUnique({
    where: { employeeCode },
    include: { ruleSet: true },
  });

  if (!employee) {
    return NextResponse.json(
      { success: false, error: `Employee code "${employeeCode}" not found` },
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
  const payPeriod = await findOpenPayPeriod();
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

  // 6. Validate state transition
  const stateBefore = await getCurrentPunchState(employee.id);
  const transition = validateTransition(stateBefore, punchType);
  if (!transition.valid) {
    return NextResponse.json(
      { success: false, error: transition.error },
      { status: 409 }
    );
  }

  // 7. Apply rounding
  const punchTime = new Date(punchTimeStr);
  const roundedTime = applyRounding(punchTime, employee.ruleSet.punchRoundingMinutes);

  // 8. Create punch + audit log in transaction
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
          note: note ?? null,
        },
      });
      await writeAuditLog({
        actorId: employee.id,
        action: "PUNCH_RECORDED",
        entityType: "PUNCH",
        entityId: p.id,
        changes: { after: { punchType, source: "KIOSK", stateAfter: transition.newState } },
      });
      return p;
    });

    // 9. Rebuild segments
    await rebuildSegments(punch.timesheetId, employee.ruleSet);

    return NextResponse.json({
      success: true,
      punchId: punch.id,
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
