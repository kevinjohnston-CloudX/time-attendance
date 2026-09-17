import { db } from "@/lib/db";
import type { PunchSource, PunchState, PunchType } from "@prisma/client";

export async function getCurrentPunchState(employeeId: string): Promise<PunchState> {
  const [lastApproved, lastSystemReset] = await Promise.all([
    db.punch.findFirst({
      where: { employeeId, isApproved: true, isRejected: false, correctedById: null },
      orderBy: { roundedTime: "desc" },
      select: { stateAfter: true, roundedTime: true },
    }),
    db.punch.findFirst({
      where: { employeeId, isApproved: false, isRejected: false, source: "SYSTEM" },
      orderBy: { roundedTime: "desc" },
      select: { stateAfter: true, roundedTime: true },
    }),
  ]);

  if (!lastApproved && !lastSystemReset) return "OUT";
  if (!lastSystemReset) return lastApproved!.stateAfter;
  if (!lastApproved) return lastSystemReset.stateAfter;

  // Most recent punch (approved or system-reset) determines state
  return lastApproved.roundedTime >= lastSystemReset.roundedTime
    ? lastApproved.stateAfter
    : lastSystemReset.stateAfter;
}

export async function saveRejectedPunch(params: {
  employeeId: string;
  timesheetId: string | null;
  punchType: PunchType;
  source: PunchSource;
  stateBefore: PunchState;
  rejectionReason: string;
}): Promise<void> {
  const now = new Date();
  await db.punch.create({
    data: {
      employeeId: params.employeeId,
      timesheetId: params.timesheetId,
      punchType: params.punchType,
      punchTime: now,
      roundedTime: now,
      source: params.source,
      stateBefore: params.stateBefore,
      stateAfter: params.stateBefore, // state unchanged — punch was rejected
      isApproved: false,
      isRejected: true,
      rejectionReason: params.rejectionReason,
    },
  });
}

/**
 * Resolves the open pay period for an employee.
 * When the employee's rule set has its own pay period schedule, that period is
 * returned first. If none is found (e.g. the rule set has no schedule configured
 * yet), falls back to the tenant-level period (ruleSetId = null).
 */
export async function findOpenPayPeriod(
  tenantId: string | null,
  ruleSetId?: string | null
) {
  const now = new Date();

  // Try rule-set-specific period first when ruleSetId is provided
  if (ruleSetId) {
    const rsPeriod = await db.payPeriod.findFirst({
      where: {
        ruleSetId,
        startDate: { lte: now },
        endDate: { gt: now },
        status: "OPEN",
      },
    });
    if (rsPeriod) return rsPeriod;
  }

  // Fall back to tenant-level period (legacy / no rule-set schedule configured)
  return db.payPeriod.findFirst({
    where: {
      ...(tenantId && { tenantId }),
      ruleSetId: null,
      startDate: { lte: now },
      endDate: { gt: now },
      status: "OPEN",
    },
  });
}
