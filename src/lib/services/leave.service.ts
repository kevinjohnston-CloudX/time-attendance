import { parseISO, getYear } from "date-fns";
import { db } from "@/lib/db";
import { validateLeaveTransition } from "@/lib/state-machines/leave-state";
import { syncLeaveSegments } from "@/lib/engines/leave-segment-builder";
import { writeAuditLog } from "@/lib/audit/logger";
import { requestLeaveSchema } from "@/lib/validators/leave.schema";

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
    startDate: string;
    endDate: string;
    durationMinutes: number;
    note?: string;
  },
) {
  const { leaveTypeId, startDate, endDate, durationMinutes, note } =
    requestLeaveSchema.parse(input);

  return db.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId,
      startDate: parseISO(startDate),
      endDate: parseISO(endDate),
      durationMinutes,
      note,
      status: "DRAFT",
    },
  });
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

  await syncLeaveSegments(leaveRequestId);

  return updated;
}
