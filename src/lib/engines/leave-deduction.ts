import { getYear } from "date-fns";
import { db } from "@/lib/db";
import type { LeaveCategory, PayBucket } from "@prisma/client";

function categoryToPayBucket(category: LeaveCategory): PayBucket | null {
  const map: Partial<Record<LeaveCategory, PayBucket>> = {
    PTO: "PTO",
    SICK: "SICK",
    HOLIDAY: "HOLIDAY",
    FMLA: "FMLA",
    BEREAVEMENT: "BEREAVEMENT",
    JURY_DUTY: "JURY_DUTY",
    MILITARY: "MILITARY",
    UNPAID: "UNPAID",
  };
  return map[category] ?? null;
}

const BUCKET_TO_CATEGORY: Partial<Record<PayBucket, LeaveCategory>> = {
  PTO: "PTO",
  SICK: "SICK",
  FMLA: "FMLA",
  BEREAVEMENT: "BEREAVEMENT",
  JURY_DUTY: "JURY_DUTY",
  MILITARY: "MILITARY",
};

async function debitBalance(
  employeeId: string,
  leaveTypeId: string,
  leaveRequestId: string,
  durationMinutes: number,
  accrualYear: number,
  actorId?: string | null
): Promise<void> {
  const balance = await db.leaveBalance.upsert({
    where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear } },
    update: {},
    create: { employeeId, leaveTypeId, accrualYear, balanceMinutes: 0, usedMinutes: 0 },
  });
  const delta = -durationMinutes;
  const newBalance = balance.balanceMinutes + delta;
  await db.$transaction([
    db.leaveBalance.update({
      where: { id: balance.id },
      data: { balanceMinutes: newBalance, usedMinutes: { increment: durationMinutes } },
    }),
    db.leaveAccrualLedger.create({
      data: {
        employeeId,
        leaveTypeId,
        action: "TIMECARD_DEDUCTION",
        deltaMinutes: delta,
        balanceAfter: newBalance,
        leaveRequestId,
        createdById: actorId ?? null,
        note: "Timecard entry",
      },
    }),
  ]);
}

async function reverseDebit(
  employeeId: string,
  leaveTypeId: string,
  leaveRequestId: string,
  accrualYear: number,
  actorId?: string | null,
  note?: string | null
): Promise<void> {
  const usageEntry = await db.leaveAccrualLedger.findFirst({
    where: { leaveRequestId, action: { in: ["USAGE", "TIMECARD_DEDUCTION"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!usageEntry) return;

  const balance = await db.leaveBalance.findFirst({
    where: { employeeId, leaveTypeId, accrualYear },
  });
  if (!balance) return;

  const reversal = -usageEntry.deltaMinutes;
  const newBalance = balance.balanceMinutes + reversal;
  await db.$transaction([
    db.leaveBalance.update({
      where: { id: balance.id },
      data: { balanceMinutes: newBalance, usedMinutes: { decrement: reversal } },
    }),
    db.leaveAccrualLedger.create({
      data: {
        employeeId,
        leaveTypeId,
        action: "ADJUSTMENT",
        deltaMinutes: reversal,
        balanceAfter: newBalance,
        leaveRequestId,
        createdById: actorId ?? null,
        note: note ?? "Timecard entry",
      },
    }),
  ]);
}

/**
 * After every rebuildSegments run (and after setSegmentPayCode changes):
 * 1. Applies the payCodeId (and derived payBucketOverride) from each CLOCK_IN punch
 *    to the WORK segments in that punch pair's time range — so custom pay codes
 *    survive segment wipe-and-recreate.
 * 2. For pay codes linked to a leave type, reconciles the employee's leave balance:
 *    creates, adjusts, or cancels a LeaveRequest tied to the originating punch.
 *    All balance changes are appended to the immutable LeaveAccrualLedger.
 *
 * Leave type lookup order:
 *   a) LeaveType.payCodeId explicitly pointing at this pay code
 *   b) Fallback: LeaveType.category matching the pay code's payBucket
 */
/**
 * Handles leave deduction for salary employees (and any punchless segment).
 * Called from setSegmentPayCode when no originating CLOCK_IN punch is found.
 * Looks up or cancels a POSTED LeaveRequest keyed by employee + date + no sourcePunchId.
 */
export async function reconcileSalarySegmentDeduction(
  segmentId: string,
  newPayCodeId: string | null,
  employeeId: string,
  tenantId: string,
  actorId?: string | null,
): Promise<void> {
  // Fetch the segment including its linked leave request (if any)
  const segment = await db.workSegment.findUnique({
    where: { id: segmentId },
    select: { segmentDate: true, durationMinutes: true, leaveRequestId: true },
  });
  if (!segment) return;

  const segDate = segment.segmentDate;
  const accrualYear = getYear(segDate);

  // Look up the request already linked to THIS segment (avoids mistakenly finding
  // regular leave requests for the same employee+date).
  const existing = segment.leaveRequestId
    ? await db.leaveRequest.findUnique({
        where: { id: segment.leaveRequestId },
        select: { id: true, leaveTypeId: true, durationMinutes: true, status: true, startDate: true },
      })
    : null;

  // Resolve leave type from the new pay code
  let newLeaveType: { id: string } | null = null;
  if (newPayCodeId) {
    newLeaveType = await db.leaveType.findFirst({
      where: { payCodeId: newPayCodeId, isActive: true, tenantId },
      select: { id: true },
    });
    if (!newLeaveType) {
      const payCode = await db.payCode.findUnique({
        where: { id: newPayCodeId },
        select: { payBucket: true },
      });
      if (payCode?.payBucket) {
        const category = BUCKET_TO_CATEGORY[payCode.payBucket];
        if (category) {
          newLeaveType = await db.leaveType.findFirst({
            where: { category, isActive: true, tenantId },
            select: { id: true },
          });
        }
      }
    }
  }

  // Clearing pay code or no leave type found → cancel existing deduction
  if (!newLeaveType) {
    if (existing && existing.status !== "CANCELLED") {
      if (existing.status === "POSTED") {
        await reverseDebit(employeeId, existing.leaveTypeId, existing.id, getYear(existing.startDate), actorId);
      }
      await db.leaveRequest.update({
        where: { id: existing.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }
    // Unlink the segment regardless
    await db.workSegment.update({ where: { id: segmentId }, data: { leaveRequestId: null } });
    return;
  }

  const newDuration = segment.durationMinutes;

  if (!existing || existing.status === "CANCELLED") {
    // No prior active request — create and debit
    const req = await db.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: newLeaveType.id,
        status: "POSTED",
        startDate: segDate,
        endDate: segDate,
        durationMinutes: newDuration,
        submittedAt: new Date(),
        reviewedAt: new Date(),
        postedAt: new Date(),
      },
    });
    await debitBalance(employeeId, newLeaveType.id, req.id, newDuration, accrualYear, actorId);
    await db.workSegment.update({ where: { id: segmentId }, data: { leaveRequestId: req.id } });
    return;
  }

  if (existing.leaveTypeId !== newLeaveType.id) {
    // Leave type changed — reverse old, create new
    if (existing.status === "POSTED") {
      await reverseDebit(employeeId, existing.leaveTypeId, existing.id, getYear(existing.startDate), actorId);
    }
    await db.leaveRequest.update({
      where: { id: existing.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    const req = await db.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: newLeaveType.id,
        status: "POSTED",
        startDate: segDate,
        endDate: segDate,
        durationMinutes: newDuration,
        submittedAt: new Date(),
        reviewedAt: new Date(),
        postedAt: new Date(),
      },
    });
    await debitBalance(employeeId, newLeaveType.id, req.id, newDuration, accrualYear, actorId);
    await db.workSegment.update({ where: { id: segmentId }, data: { leaveRequestId: req.id } });
    return;
  }

  if (existing.durationMinutes !== newDuration) {
    // Same leave type, duration changed — reverse and re-debit
    if (existing.status === "POSTED") {
      await reverseDebit(employeeId, existing.leaveTypeId, existing.id, accrualYear, actorId);
    }
    await db.leaveRequest.update({ where: { id: existing.id }, data: { durationMinutes: newDuration } });
    await debitBalance(employeeId, newLeaveType.id, existing.id, newDuration, accrualYear, actorId);
  }
  // Same leave type + same duration → nothing to do
}

export async function reconcileLeaveDeductions(
  timesheetId: string,
  employeeId: string,
  tenantId: string,
  actorId?: string | null
): Promise<void> {
  const activePunches = await db.punch.findMany({
    where: { timesheetId, isApproved: true, correctedById: null },
    orderBy: { roundedTime: "asc" },
    select: { id: true, punchType: true, roundedTime: true, payCodeId: true, approvedById: true },
  });

  const activePunchIds = new Set(activePunches.map((p) => p.id));

  // Cancel leave requests whose originating punch was corrected/tombstoned
  const openRequests = await db.leaveRequest.findMany({
    where: { employeeId, sourcePunchId: { not: null }, status: { notIn: ["CANCELLED"] } },
  });

  for (const req of openRequests) {
    if (req.sourcePunchId && !activePunchIds.has(req.sourcePunchId)) {
      const accrualYear = getYear(req.startDate);
      if (req.status === "POSTED") {
        // Find who corrected/tombstoned the original punch
        const tombstone = await db.punch.findFirst({
          where: { correctsId: req.sourcePunchId },
          select: { approvedById: true },
        });
        const reversalActor = tombstone?.approvedById ?? actorId ?? null;
        await reverseDebit(employeeId, req.leaveTypeId, req.id, accrualYear, reversalActor);
      }
      await db.leaveRequest.update({
        where: { id: req.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }
  }

  // Refresh after orphan cancellations
  const stillOpen = await db.leaveRequest.findMany({
    where: { employeeId, sourcePunchId: { not: null }, status: { notIn: ["CANCELLED"] } },
    select: { id: true, sourcePunchId: true, status: true, durationMinutes: true, leaveTypeId: true, startDate: true },
  });
  const requestByPunch = new Map(stillOpen.map((r) => [r.sourcePunchId!, r]));

  // Track which open requests the main loop touches — any untouched ones at the end
  // have had their pay code cleared or changed and should be cancelled.
  const handledRequestIds = new Set<string>();

  for (let i = 0; i < activePunches.length; i++) {
    const clockIn = activePunches[i];
    if (clockIn.punchType !== "CLOCK_IN" || !clockIn.payCodeId) continue;

    const clockOut = activePunches.slice(i + 1).find((p) => p.punchType === "CLOCK_OUT") ?? null;

    // Fetch pay code once — used for both leave-type lookup and bucket derivation
    const payCode = await db.payCode.findUnique({
      where: { id: clockIn.payCodeId },
      select: { payBucket: true },
    });

    // Find linked leave type: explicit payCodeId link first, payBucket category fallback
    let leaveType = await db.leaveType.findFirst({
      where: { payCodeId: clockIn.payCodeId, isActive: true, tenantId },
    });
    if (!leaveType && payCode?.payBucket) {
      const category = BUCKET_TO_CATEGORY[payCode.payBucket];
      if (category) {
        leaveType = await db.leaveType.findFirst({ where: { category, isActive: true, tenantId } });
      }
    }

    // Upper bound on segmentDate: day after the UTC date of the CLOCK_IN.
    // Salary auto-credit segments are created at midnight UTC of their date,
    // which can fall inside a previous-day evening punch window (e.g. a 9 PM
    // EDT clock-out = 01:00 UTC next day). Capping by segmentDate prevents
    // those salary segments from being incorrectly tagged with the punch's pay code.
    // For true overnight shifts the CLOCK_IN's UTC date is already the "next" day,
    // so +1 day gives a 2-day window that covers both local dates.
    const clockInDayEnd = new Date(clockIn.roundedTime);
    clockInDayEnd.setUTCHours(0, 0, 0, 0);
    clockInDayEnd.setUTCDate(clockInDayEnd.getUTCDate() + 1);

    // Collect WORK segments produced by this punch pair
    const segs = await db.workSegment.findMany({
      where: {
        timesheetId,
        segmentType: "WORK",
        startTime: {
          gte: clockIn.roundedTime,
          ...(clockOut ? { lt: clockOut.roundedTime } : {}),
        },
        segmentDate: { lt: clockInDayEnd },
      },
      select: { id: true, durationMinutes: true, segmentDate: true },
    });

    if (segs.length > 0) {
      // effectiveBucket: from leave type category, or pay code's own payBucket
      const effectiveBucket: PayBucket | null = leaveType
        ? categoryToPayBucket(leaveType.category)
        : (payCode?.payBucket ?? null);

      await db.workSegment.updateMany({
        where: { id: { in: segs.map((s) => s.id) } },
        data: {
          payCodeId: clockIn.payCodeId,
          ...(effectiveBucket ? { payBucketOverride: effectiveBucket } : {}),
        },
      });
    }

    if (!leaveType) continue;

    const newDuration = segs.reduce((s, seg) => s + seg.durationMinutes, 0);
    const existing = requestByPunch.get(clockIn.id) ?? null;

    if (existing) handledRequestIds.add(existing.id);

    if (!existing) {
      if (newDuration > 0) {
        const startDate = segs[0]!.segmentDate;
        const accrualYear = getYear(startDate);
        const req = await db.leaveRequest.create({
          data: {
            employeeId,
            leaveTypeId: leaveType.id,
            status: "POSTED",
            startDate,
            endDate: startDate,
            durationMinutes: newDuration,
            sourcePunchId: clockIn.id,
            submittedAt: new Date(),
            reviewedAt: new Date(),
            postedAt: new Date(),
          },
        });
        await debitBalance(employeeId, leaveType.id, req.id, newDuration, accrualYear, clockIn.approvedById);
        handledRequestIds.add(req.id);
      }
    } else {
      const accrualYear = getYear(existing.startDate);
      if (newDuration === 0) {
        if (existing.status === "POSTED") {
          await reverseDebit(employeeId, existing.leaveTypeId, existing.id, accrualYear, clockIn.approvedById);
        }
        await db.leaveRequest.update({
          where: { id: existing.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        handledRequestIds.delete(existing.id);
      } else if (leaveType.id !== existing.leaveTypeId) {
        // Pay code changed to a different leave type — reverse the old deduction,
        // cancel the old request (clear sourcePunchId so the new one can claim it),
        // then create a fresh request for the new leave type.
        if (existing.status === "POSTED") {
          await reverseDebit(employeeId, existing.leaveTypeId, existing.id, accrualYear, clockIn.approvedById);
        }
        await db.leaveRequest.update({
          where: { id: existing.id },
          data: { status: "CANCELLED", cancelledAt: new Date(), sourcePunchId: null },
        });
        // existing.id stays in handledRequestIds so the cleanup loop doesn't re-cancel it
        const startDate = segs[0]!.segmentDate;
        const newAccrualYear = getYear(startDate);
        const newReq = await db.leaveRequest.create({
          data: {
            employeeId,
            leaveTypeId: leaveType.id,
            status: "POSTED",
            startDate,
            endDate: startDate,
            durationMinutes: newDuration,
            sourcePunchId: clockIn.id,
            submittedAt: new Date(),
            reviewedAt: new Date(),
            postedAt: new Date(),
          },
        });
        await debitBalance(employeeId, leaveType.id, newReq.id, newDuration, newAccrualYear, clockIn.approvedById);
        handledRequestIds.add(newReq.id);
      } else if (newDuration !== existing.durationMinutes) {
        if (existing.status === "POSTED") {
          await reverseDebit(employeeId, existing.leaveTypeId, existing.id, accrualYear, clockIn.approvedById);
        }
        await db.leaveRequest.update({
          where: { id: existing.id },
          data: { durationMinutes: newDuration },
        });
        await debitBalance(employeeId, existing.leaveTypeId, existing.id, newDuration, accrualYear, clockIn.approvedById);
      }
    }
  }

  // Cancel any open requests that weren't handled — their source punch's pay code was
  // cleared or changed to a non-leave code since the last reconciliation.
  for (const req of stillOpen) {
    if (!handledRequestIds.has(req.id)) {
      const accrualYear = getYear(req.startDate);
      if (req.status === "POSTED") {
        await reverseDebit(employeeId, req.leaveTypeId, req.id, accrualYear, actorId);
      }
      await db.leaveRequest.update({
        where: { id: req.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }
  }
}
