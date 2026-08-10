import { parseISO, getYear, differenceInMonths } from "date-fns";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { validateLeaveTransition } from "@/lib/state-machines/leave-state";
import { syncLeaveSegments } from "@/lib/engines/leave-segment-builder";
import { reverseLeaveUsage } from "@/lib/engines/accrual-engine";
import { writeAuditLog } from "@/lib/audit/logger";
import { requestLeaveSchema, type DaySelectionInput } from "@/lib/validators/leave.schema";

// ─── Queries ────────────────────────────────────────────────────────────────

export async function getLeaveRequestsCore(employeeId: string) {
  return db.leaveRequest.findMany({
    where: { employeeId },
    include: { leaveType: true },
    orderBy: { startDate: "desc" },
  });
}

export async function getLeaveTypesCore(tenantId: string | null) {
  return db.leaveType.findMany({
    where: { isActive: true, tenantId: tenantId ?? undefined },
    orderBy: { name: "asc" },
  });
}

export async function getLeaveBalancesCore(employeeId: string) {
  const year = getYear(new Date());
  return db.leaveBalance.findMany({
    where: { employeeId, accrualYear: year },
    include: { leaveType: true },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export async function createLeaveRequestCore(
  employeeId: string,
  input: {
    leaveTypeId: string;
    selectedDays: DaySelectionInput[];
    note?: string;
  },
) {
  const { leaveTypeId, selectedDays, note } = requestLeaveSchema.parse(input);

  const employee = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: {
      shift: { select: { startTime: true, endTime: true } },
      ruleSet: { select: { mealBreakMinutes: true, mealBreakAfterMinutes: true } },
      siteId: true,
      ptoPolicyOverrides: {
        select: {
          ptoPolicy: {
            select: {
              maxDailyHours: true,
              rules: { where: { leaveTypeId }, select: { id: true } },
            },
          },
        },
      },
      payCategory: {
        select: {
          ptoPolicies: {
            include: {
              ptoPolicy: {
                select: {
                  maxDailyHours: true,
                  rules: { where: { leaveTypeId }, select: { id: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const shiftStartMins    = employee.shift ? timeToMins(employee.shift.startTime) : 9 * 60;
  const shiftEndMins      = employee.shift ? timeToMins(employee.shift.endTime)   : 17 * 60;
  const mealBreakMins     = employee.ruleSet?.mealBreakMinutes     ?? 0;
  const mealBreakAfter    = employee.ruleSet?.mealBreakAfterMinutes ?? 300;
  const mealBreakStart    = shiftStartMins + mealBreakAfter;
  const mealBreakEnd      = mealBreakStart + mealBreakMins;

  // Resolve max daily minutes from policy (override > pay category > site), matching engine priority
  let maxDailyMinutes: number | null = null;
  const override = employee.ptoPolicyOverrides[0];
  if (override?.ptoPolicy.rules.length && override.ptoPolicy.maxDailyHours != null) {
    maxDailyMinutes = Math.round(override.ptoPolicy.maxDailyHours * 60);
  } else {
    for (const link of employee.payCategory?.ptoPolicies ?? []) {
      if (link.ptoPolicy.rules.length && link.ptoPolicy.maxDailyHours != null) {
        maxDailyMinutes = Math.round(link.ptoPolicy.maxDailyHours * 60);
        break;
      }
    }
  }
  if (maxDailyMinutes === null && employee.siteId) {
    const sitePolicy = await db.sitePtoPolicy.findFirst({
      where: { siteId: employee.siteId, leaveTypeId },
      select: { ptoPolicy: { select: { maxDailyHours: true } } },
    });
    if (sitePolicy?.ptoPolicy.maxDailyHours != null) {
      maxDailyMinutes = Math.round(sitePolicy.ptoPolicy.maxDailyHours * 60);
    }
  }

  const sorted = [...selectedDays].sort((a, b) => a.date.localeCompare(b.date));

  let durationMinutes = 0;
  for (const day of sorted) {
    let dayMins: number;
    if (day.type === "FULL") {
      dayMins = (shiftEndMins - shiftStartMins) - mealBreakMins;
    } else {
      const leaveFrom    = timeToMins(day.leaveFrom);
      const leaveTo      = timeToMins(day.leaveTo);
      const raw          = Math.max(0, leaveTo - leaveFrom);
      const overlapStart = Math.max(leaveFrom, mealBreakStart);
      const overlapEnd   = Math.min(leaveTo, mealBreakEnd);
      const overlap      = Math.max(0, overlapEnd - overlapStart);
      dayMins            = Math.max(0, raw - overlap);
    }
    if (maxDailyMinutes !== null && dayMins > maxDailyMinutes) {
      const maxH = Math.floor(maxDailyMinutes / 60);
      const maxM = maxDailyMinutes % 60;
      throw new Error(
        `${day.date}: requested ${Math.round(dayMins / 60 * 10) / 10}h exceeds the ${maxH}h${maxM ? ` ${maxM}m` : ""} daily maximum for this leave type.`
      );
    }
    durationMinutes += dayMins;
  }

  return db.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId,
      startDate: parseISO(sorted[0].date),
      endDate:   parseISO(sorted[sorted.length - 1].date),
      durationMinutes,
      selectedDays: selectedDays as unknown as Prisma.InputJsonValue,
      note,
      status: "DRAFT",
    },
  });
}

function timeToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// ─── Balance validation ──────────────────────────────────────────────────────

type PolicyForValidation = {
  allowNegativeBalance: boolean;
  maxNegativeHours:     number | null;
  serviceMonthBasis:    string;
  rules: { minTenureMonths: number; maxTenureMonths: number | null; maxAnnualHours: number | null }[];
};

export async function validateBalanceForApproval(leaveRequestId: string): Promise<void> {
  const request = await db.leaveRequest.findUniqueOrThrow({
    where: { id: leaveRequestId },
    select: { employeeId: true, leaveTypeId: true, durationMinutes: true, startDate: true },
  });

  const { employeeId, leaveTypeId, durationMinutes, startDate } = request;
  const accrualYear = getYear(startDate);

  const balance = await db.leaveBalance.findUnique({
    where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear } },
    select: { balanceMinutes: true, usedMinutes: true },
  });

  const currentMins   = balance?.balanceMinutes ?? 0;
  const usedMins      = balance?.usedMinutes    ?? 0;
  const projectedMins = currentMins - durationMinutes;

  const employee = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: {
      siteId:           true,
      hireDate:         true,
      adjustedHireDate: true,
      titleChangeDate:  true,
      orientationDate:  true,
      userDate2:        true,
      ptoPolicyOverrides: {
        select: {
          ptoPolicy: {
            select: {
              allowNegativeBalance: true,
              maxNegativeHours:     true,
              serviceMonthBasis:    true,
              rules: {
                where:  { leaveTypeId },
                select: { minTenureMonths: true, maxTenureMonths: true, maxAnnualHours: true },
              },
            },
          },
        },
      },
      payCategory: {
        select: {
          ptoPolicies: {
            include: {
              ptoPolicy: {
                select: {
                  allowNegativeBalance: true,
                  maxNegativeHours:     true,
                  serviceMonthBasis:    true,
                  rules: {
                    where:  { leaveTypeId },
                    select: { minTenureMonths: true, maxTenureMonths: true, maxAnnualHours: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // Resolve the applicable policy (override → pay category → site)
  let policy: PolicyForValidation | null = null;

  const override = employee.ptoPolicyOverrides[0];
  if (override?.ptoPolicy.rules.length) {
    policy = override.ptoPolicy;
  } else {
    for (const link of employee.payCategory?.ptoPolicies ?? []) {
      if (link.ptoPolicy.rules.length) {
        policy = link.ptoPolicy;
        break;
      }
    }
  }
  if (!policy && employee.siteId) {
    const siteRow = await db.sitePtoPolicy.findFirst({
      where: { siteId: employee.siteId, leaveTypeId },
      select: {
        ptoPolicy: {
          select: {
            allowNegativeBalance: true,
            maxNegativeHours:     true,
            serviceMonthBasis:    true,
            rules: {
              where:  { leaveTypeId },
              select: { minTenureMonths: true, maxTenureMonths: true, maxAnnualHours: true },
            },
          },
        },
      },
    });
    if (siteRow) policy = siteRow.ptoPolicy;
  }

  const fmt = (mins: number) => `${Math.round(Math.abs(mins) / 60 * 10) / 10}h`;

  // ── Annual usage cap check ──────────────────────────────────────────────────
  if (policy) {
    const basisDate =
      policy.serviceMonthBasis === "ADJUSTED_HIRE_DATE" ? (employee.adjustedHireDate ?? employee.hireDate) :
      policy.serviceMonthBasis === "TITLE_CHANGE_DATE"  ? (employee.titleChangeDate  ?? employee.hireDate) :
      policy.serviceMonthBasis === "ORIENTATION_DATE"   ? (employee.orientationDate  ?? employee.hireDate) :
      policy.serviceMonthBasis === "USER_DATE_2"        ? (employee.userDate2        ?? employee.hireDate) :
      employee.hireDate;

    if (basisDate) {
      const tenureMonths = differenceInMonths(startDate, basisDate);
      const sortedRules  = [...policy.rules].sort((a, b) => a.minTenureMonths - b.minTenureMonths);
      const tier = sortedRules.findLast(
        (r) => r.minTenureMonths <= tenureMonths &&
               (r.maxTenureMonths === null || tenureMonths < r.maxTenureMonths)
      );

      if (tier?.maxAnnualHours != null) {
        const capMins       = Math.round(tier.maxAnnualHours * 60);
        const projectedUsed = usedMins + durationMinutes;
        if (projectedUsed > capMins) {
          throw new Error(
            `Annual usage limit: approving this request would bring total usage to ${fmt(projectedUsed)} this year, exceeding the ${tier.maxAnnualHours}h annual maximum for this leave type.`
          );
        }
      }
    }
  }

  // ── Borrow / negative balance check ────────────────────────────────────────
  if (projectedMins >= 0) return;

  const allowBorrow = policy?.allowNegativeBalance ?? false;
  const maxNegHours = policy?.maxNegativeHours     ?? null;

  if (!allowBorrow) {
    throw new Error(
      `Insufficient balance: employee has ${fmt(currentMins)} available but this request requires ${fmt(durationMinutes)}. Borrowing against future accruals is not enabled for this leave type.`
    );
  }

  if (maxNegHours !== null) {
    const maxNegMins = Math.round(maxNegHours * 60);
    if (projectedMins < -maxNegMins) {
      throw new Error(
        `Insufficient balance: approving this request would leave the employee ${fmt(-projectedMins)} in deficit, exceeding the ${maxNegHours}h borrow limit.`
      );
    }
  }
}

export async function submitLeaveRequestCore(
  employeeId: string,
  tenantId: string | null,
  leaveRequestId: string,
) {
  const request = await db.leaveRequest.findUniqueOrThrow({
    where: { id: leaveRequestId },
  });

  if (request.employeeId !== employeeId)
    throw new Error("Cannot submit another employee's leave request");

  const transition = validateLeaveTransition(request.status, "SUBMIT");
  if (!transition.valid) throw new Error(transition.error);

  const updated = await db.leaveRequest.update({
    where: { id: leaveRequestId },
    data: { status: transition.newStatus, submittedAt: new Date() },
  });

  await writeAuditLog({
    tenantId,
    actorId: employeeId,
    entityType: "LEAVE_REQUEST",
    entityId: leaveRequestId,
    action: "SUBMITTED",
    changes: { before: request.status, after: transition.newStatus },
  });

  return updated;
}

export async function cancelLeaveRequestCore(
  employeeId: string,
  tenantId: string | null,
  leaveRequestId: string,
) {
  const request = await db.leaveRequest.findUniqueOrThrow({
    where: { id: leaveRequestId },
  });

  if (request.employeeId !== employeeId)
    throw new Error("Cannot cancel another employee's leave request");

  const transition = validateLeaveTransition(request.status, "CANCEL");
  if (!transition.valid) throw new Error(transition.error);

  const updated = await db.leaveRequest.update({
    where: { id: leaveRequestId },
    data: { status: transition.newStatus, cancelledAt: new Date() },
  });

  await writeAuditLog({
    tenantId,
    actorId: employeeId,
    entityType: "LEAVE_REQUEST",
    entityId: leaveRequestId,
    action: "CANCELLED",
    changes: { before: request.status, after: transition.newStatus },
  });

  // If the request was already approved (and thus debited), reverse the balance debit
  if (request.status === "APPROVED") {
    await reverseLeaveUsage(leaveRequestId);
  }

  await syncLeaveSegments(leaveRequestId);

  return updated;
}
