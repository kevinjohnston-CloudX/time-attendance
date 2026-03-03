import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { applyRounding } from "@/lib/utils/date";
import {
  getCurrentPunchState,
  findOpenPayPeriod,
} from "@/lib/utils/punch-helpers";
import { validateTransition } from "@/lib/state-machines/punch-state";
import { recordPunchSchema } from "@/lib/validators/punch.schema";
import type { PunchSource, Punch } from "@prisma/client";

interface PunchServiceContext {
  employeeId: string;
  tenantId: string | null;
  source: PunchSource;
}

export async function recordPunchCore(
  ctx: PunchServiceContext,
  input: { punchType: string; note?: string },
): Promise<Punch> {
  const { punchType, note } = recordPunchSchema.parse(input);
  const { employeeId, tenantId, source } = ctx;

  const employee = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: { ruleSet: true },
  });

  const payPeriod = await findOpenPayPeriod(tenantId);
  if (!payPeriod) throw new Error("No active pay period. Contact payroll.");

  const timesheet = await findOrCreateTimesheet(employeeId, payPeriod.id);
  if (timesheet.status === "LOCKED")
    throw new Error("Timesheet is locked for this pay period.");

  const stateBefore = await getCurrentPunchState(employeeId);
  const transition = validateTransition(stateBefore, punchType);
  if (!transition.valid) throw new Error(transition.error);

  const punchTime = new Date();
  const roundedTime = applyRounding(
    punchTime,
    employee.ruleSet.punchRoundingMinutes,
  );

  const punch = await db.$transaction(async (tx) => {
    const p = await tx.punch.create({
      data: {
        employeeId,
        timesheetId: timesheet.id,
        punchType,
        punchTime,
        roundedTime,
        source,
        stateBefore,
        stateAfter: transition.newState,
        isApproved: true,
        note,
      },
    });
    await writeAuditLog({
      tenantId,
      actorId: employeeId,
      action: "PUNCH_RECORDED",
      entityType: "PUNCH",
      entityId: p.id,
      changes: {
        after: { punchType, source, stateAfter: transition.newState },
      },
    });
    return p;
  });

  await rebuildSegments(punch.timesheetId, employee.ruleSet);

  return punch;
}
