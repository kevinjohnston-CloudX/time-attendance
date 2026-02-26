"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { applyRounding } from "@/lib/utils/date";
import {
  validateTransition,
} from "@/lib/state-machines/punch-state";
import {
  recordPunchSchema,
  requestMissedPunchSchema,
  correctPunchSchema,
  approveMissedPunchSchema,
  type RecordPunchInput,
  type RequestMissedPunchInput,
  type CorrectPunchInput,
} from "@/lib/validators/punch.schema";
import type { ActionResult } from "@/types/api";
import type { Punch, PunchState } from "@prisma/client";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getCurrentPunchState(employeeId: string): Promise<PunchState> {
  const last = await db.punch.findFirst({
    where: { employeeId, isApproved: true, correctedById: null },
    orderBy: { roundedTime: "desc" },
  });
  return last?.stateAfter ?? "OUT";
}

async function findOpenPayPeriod() {
  const now = new Date();
  return db.payPeriod.findFirst({
    where: {
      startDate: { lte: now },
      endDate: { gte: now },
      status: "OPEN",
    },
  });
}

async function findOrCreateTimesheet(
  employeeId: string,
  payPeriodId: string
) {
  const existing = await db.timesheet.findUnique({
    where: { employeeId_payPeriodId: { employeeId, payPeriodId } },
  });
  if (existing) return existing;
  return db.timesheet.create({ data: { employeeId, payPeriodId } });
}

// ─── recordPunch ─────────────────────────────────────────────────────────────

export const recordPunch = withRBAC(
  "PUNCH_OWN",
  async ({ employeeId }, input: RecordPunchInput): Promise<Punch> => {
    const parsed = recordPunchSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const { punchType, note } = parsed.data;

    const employee = await db.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { ruleSet: true },
    });

    const payPeriod = await findOpenPayPeriod();
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
      employee.ruleSet.punchRoundingMinutes
    );

    const punch = await db.$transaction(async (tx) => {
      const p = await tx.punch.create({
        data: {
          employeeId,
          timesheetId: timesheet.id,
          punchType,
          punchTime,
          roundedTime,
          source: "WEB",
          stateBefore,
          stateAfter: transition.newState,
          isApproved: true,
          note,
        },
      });
      await writeAuditLog({
        actorId: employeeId,
        action: "PUNCH_RECORDED",
        entityType: "PUNCH",
        entityId: p.id,
        changes: { after: { punchType, stateAfter: transition.newState } },
      });
      return p;
    });

    await rebuildSegments(punch.timesheetId, employee.ruleSet);

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
    { employeeId },
    input: RequestMissedPunchInput
  ): Promise<Punch> => {
    const parsed = requestMissedPunchSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const { punchType, punchTime: punchTimeStr, note } = parsed.data;
    const punchTime = new Date(punchTimeStr);

    const employee = await db.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { ruleSet: true },
    });

    const payPeriod = await findOpenPayPeriod();
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
  async ({ employeeId: supervisorId }, input: { punchId: string }): Promise<Punch> => {
    const parsed = approveMissedPunchSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const session = await auth();
    const punch = await db.punch.findUniqueOrThrow({
      where: { id: parsed.data.punchId },
    });

    if (punch.isApproved) throw new Error("Punch is already approved.");

    const updated = await db.$transaction(async (tx) => {
      const p = await tx.punch.update({
        where: { id: punch.id },
        data: {
          isApproved: true,
          approvedById: session?.user?.employeeId,
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
    { employeeId: supervisorId },
    input: CorrectPunchInput
  ): Promise<Punch> => {
    const parsed = correctPunchSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const { originalPunchId, newPunchTime: newPunchTimeStr, reason } = parsed.data;
    const newPunchTime = new Date(newPunchTimeStr);

    const original = await db.punch.findUniqueOrThrow({
      where: { id: originalPunchId },
      include: { employee: { include: { ruleSet: true } } },
    });

    if (original.correctedById) throw new Error("Punch has already been corrected.");

    const roundedTime = applyRounding(
      newPunchTime,
      original.employee.ruleSet.punchRoundingMinutes
    );

    const correction = await db.$transaction(async (tx) => {
      // Create correction punch linked to original
      const c = await tx.punch.create({
        data: {
          employeeId: original.employeeId,
          timesheetId: original.timesheetId,
          punchType: original.punchType,
          punchTime: newPunchTime,
          roundedTime,
          source: "MANUAL",
          stateBefore: original.stateBefore,
          stateAfter: original.stateAfter,
          isApproved: true,
          approvedById: supervisorId,
          approvedAt: new Date(),
          note: reason,
          correctsId: original.id,
        },
      });
      // Mark original as superseded
      await tx.punch.update({
        where: { id: original.id },
        data: { correctedById: c.id },
      });
      await writeAuditLog({
        actorId: supervisorId,
        action: "PUNCH_CORRECTED",
        entityType: "PUNCH",
        entityId: c.id,
        changes: {
          before: { punchTime: original.punchTime },
          after: { punchTime: newPunchTime, reason },
        },
      });
      return c;
    });

    await rebuildSegments(correction.timesheetId, original.employee.ruleSet);

    revalidatePath("/time/history");
    revalidatePath("/supervisor");
    revalidatePath(`/time/timesheet/${correction.timesheetId}`);
    return correction;
  }
);
