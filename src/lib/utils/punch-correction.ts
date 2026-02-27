import { applyRounding } from "@/lib/utils/date";
import { writeAuditLog } from "@/lib/audit/logger";
import type { Punch, RuleSet } from "@prisma/client";
import type { TxClient } from "@/types/prisma";

interface CorrectionInput {
  originalPunchId: string;
  newPunchTime: Date;
  reason: string;
  supervisorId: string;
}

interface CorrectionResult {
  correction: Punch;
  timesheetId: string;
  ruleSet: RuleSet;
}

/**
 * Core punch correction logic (must be called within a transaction):
 * 1. Validates the original has not been corrected
 * 2. Applies rounding per the employee's rule set
 * 3. Creates a correction punch linked to the original
 * 4. Marks the original as superseded
 * 5. Writes an audit log entry
 */
export async function createCorrectionPunch(
  tx: TxClient,
  input: CorrectionInput
): Promise<CorrectionResult> {
  const { originalPunchId, newPunchTime, reason, supervisorId } = input;

  const original = await tx.punch.findUniqueOrThrow({
    where: { id: originalPunchId },
    include: { employee: { include: { ruleSet: true } } },
  });

  if (original.correctedById) {
    throw new Error("Punch has already been corrected.");
  }

  const roundedTime = applyRounding(
    newPunchTime,
    original.employee.ruleSet.punchRoundingMinutes
  );

  const correction = await tx.punch.create({
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

  await tx.punch.update({
    where: { id: original.id },
    data: { correctedById: correction.id },
  });

  await writeAuditLog({
    actorId: supervisorId,
    action: "PUNCH_CORRECTED",
    entityType: "PUNCH",
    entityId: correction.id,
    changes: {
      before: { punchTime: original.punchTime },
      after: { punchTime: newPunchTime, reason },
    },
  });

  return {
    correction,
    timesheetId: original.timesheetId,
    ruleSet: original.employee.ruleSet,
  };
}
