"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import { createCorrectionPunch } from "@/lib/utils/punch-correction";
import { applyRounding } from "@/lib/utils/date";
import { findOpenPayPeriod } from "@/lib/utils/punch-helpers";
import { recordPunchCore } from "@/lib/services/punch.service";
import {
  requestMissedPunchSchema,
  correctPunchSchema,
  approveMissedPunchSchema,
  type RecordPunchInput,
  type RequestMissedPunchInput,
  type CorrectPunchInput,
} from "@/lib/validators/punch.schema";
import type { Punch } from "@prisma/client";


// ─── recordPunch ─────────────────────────────────────────────────────────────

export const recordPunch = withRBAC(
  "PUNCH_OWN",
  async ({ employeeId, tenantId }, input: RecordPunchInput): Promise<Punch> => {
    const punch = await recordPunchCore(
      { employeeId, tenantId, source: "WEB" },
      input,
    );

    revalidatePath("/time/punch");
    revalidatePath("/time/history");
    revalidatePath(`/time/timesheet/${punch.timesheetId}`);
    return punch;
  }
);

// ─── requestMissedPunch ───────────────────────────────────────────────────────

export const requestMissedPunch = withRBAC(
  "PUNCH_OWN",
  async (
    { employeeId, tenantId },
    input: RequestMissedPunchInput
  ): Promise<Punch> => {
    const { punchType, punchTime: punchTimeStr, note } =
      requestMissedPunchSchema.parse(input);
    const punchTime = new Date(punchTimeStr);

    const employee = await db.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { ruleSet: true },
    });

    const payPeriod = await findOpenPayPeriod(tenantId);
    if (!payPeriod) throw new Error("No active pay period. Contact payroll.");

    const timesheet = await findOrCreateTimesheet(employeeId, payPeriod.id);

    const roundedTime = applyRounding(
      punchTime,
      employee.ruleSet.punchRoundingMinutes
    );

    const punch = await db.$transaction(async (tx) => {
      // Use OUT/OUT as placeholders — supervisor will validate on approval
      const p = await tx.punch.create({
        data: {
          employeeId,
          timesheetId: timesheet.id,
          punchType,
          punchTime,
          roundedTime,
          source: "MANUAL",
          stateBefore: "OUT",
          stateAfter: "OUT",
          isApproved: false,
          note,
        },
      });
      await tx.exception.create({
        data: {
          timesheetId: timesheet.id,
          exceptionType: "MISSING_PUNCH",
          description: `Missing ${punchType} at ${punchTime.toISOString()} — ${note}`,
          occurredAt: punchTime,
        },
      });
      await writeAuditLog({
        tenantId,
        actorId: employeeId,
        action: "MISSED_PUNCH_REQUESTED",
        entityType: "PUNCH",
        entityId: p.id,
        changes: { after: { punchType, punchTime: punchTimeStr } },
      });
      return p;
    });

    revalidatePath("/time/punch");
    revalidatePath("/time/history");
    revalidatePath("/supervisor/exceptions");
    return punch;
  }
);

// ─── approveMissedPunch ───────────────────────────────────────────────────────

export const approveMissedPunch = withRBAC(
  "PUNCH_EDIT_TEAM",
  async ({ employeeId: supervisorId, tenantId }, input: { punchId: string }): Promise<Punch> => {
    const { punchId } = approveMissedPunchSchema.parse(input);

    const punch = await db.punch.findUniqueOrThrow({
      where: { id: punchId },
    });

    if (punch.isApproved) throw new Error("Punch is already approved.");

    const updated = await db.$transaction(async (tx) => {
      const p = await tx.punch.update({
        where: { id: punch.id },
        data: {
          isApproved: true,
          approvedById: supervisorId,
          approvedAt: new Date(),
        },
      });
      // Resolve the matching MISSING_PUNCH exception
      await tx.exception.updateMany({
        where: {
          timesheetId: punch.timesheetId,
          exceptionType: "MISSING_PUNCH",
          resolvedAt: null,
        },
        data: {
          resolvedAt: new Date(),
          resolvedById: supervisorId,
          resolution: "Approved by supervisor",
        },
      });
      await writeAuditLog({
        tenantId,
        actorId: supervisorId,
        action: "MISSED_PUNCH_APPROVED",
        entityType: "PUNCH",
        entityId: p.id,
      });
      return p;
    });

    const ts = await db.timesheet.findUniqueOrThrow({
      where: { id: updated.timesheetId },
      include: { employee: { include: { ruleSet: true } } },
    });
    await rebuildSegments(updated.timesheetId, ts.employee.ruleSet);

    revalidatePath("/time/history");
    revalidatePath("/supervisor/exceptions");
    revalidatePath(`/time/timesheet/${updated.timesheetId}`);
    return updated;
  }
);

// ─── correctPunch ─────────────────────────────────────────────────────────────

export const correctPunch = withRBAC(
  "PUNCH_EDIT_TEAM",
  async (
    { employeeId: supervisorId, tenantId: _tenantId },
    input: CorrectPunchInput
  ): Promise<Punch> => {
    const { originalPunchId, newPunchTime: newPunchTimeStr, reason } =
      correctPunchSchema.parse(input);
    const newPunchTime = new Date(newPunchTimeStr);

    const { correction, timesheetId, ruleSet } = await db.$transaction(
      async (tx) =>
        createCorrectionPunch(tx, {
          originalPunchId,
          newPunchTime,
          reason,
          supervisorId,
        })
    );

    await rebuildSegments(timesheetId, ruleSet);

    revalidatePath("/time/history");
    revalidatePath("/supervisor");
    revalidatePath("/payroll/timecards");
    revalidatePath(`/time/timesheet/${timesheetId}`);
    return correction;
  }
);
