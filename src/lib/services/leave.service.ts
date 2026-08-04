import { parseISO, getYear } from "date-fns";
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
    select: { shift: { select: { startTime: true, endTime: true } } },
  });

  const shiftStartMins = employee.shift ? timeToMins(employee.shift.startTime) : 9 * 60;
  const shiftEndMins   = employee.shift ? timeToMins(employee.shift.endTime)   : 17 * 60;

  const sorted = [...selectedDays].sort((a, b) => a.date.localeCompare(b.date));

  let durationMinutes = 0;
  for (const day of sorted) {
    if (day.type === "FULL") {
      durationMinutes += shiftEndMins - shiftStartMins;
    } else {
      durationMinutes += Math.max(0, shiftEndMins - timeToMins(day.leaveFrom));
    }
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
