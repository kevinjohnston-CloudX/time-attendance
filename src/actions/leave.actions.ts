"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { validateLeaveTransition } from "@/lib/state-machines/leave-state";
import { postLeaveUsage } from "@/lib/engines/accrual-engine";
import { syncLeaveSegments } from "@/lib/engines/leave-segment-builder";
import { writeAuditLog } from "@/lib/audit/logger";
import {
  getLeaveRequestsCore,
  getLeaveTypesCore,
  getLeaveBalancesCore,
  createLeaveRequestCore,
  submitLeaveRequestCore,
  cancelLeaveRequestCore,
} from "@/lib/services/leave.service";
import {
  leaveRequestIdSchema,
  reviewLeaveSchema,
  type RequestLeaveInput,
  type LeaveRequestIdInput,
  type ReviewLeaveInput,
} from "@/lib/validators/leave.schema";

// ─── Employee actions ─────────────────────────────────────────────────────────

/** List the current employee's leave requests (most recent first). */
export const getMyLeaveRequests = withRBAC(
  "LEAVE_REQUEST_OWN",
  async ({ employeeId }, _input: void) => {
    return getLeaveRequestsCore(employeeId);
  }
);

/** List active leave types (for the request form drop-down). */
export const getLeaveTypes = withRBAC(
  "LEAVE_REQUEST_OWN",
  async ({ tenantId }, _input: void) => {
    return getLeaveTypesCore(tenantId);
  }
);

/** Get the current employee's leave balances for the current year. */
export const getMyLeaveBalances = withRBAC(
  "LEAVE_REQUEST_OWN",
  async ({ employeeId }, _input: void) => {
    return getLeaveBalancesCore(employeeId);
  }
);

/** Create a leave request in DRAFT status. */
export const createLeaveRequest = withRBAC(
  "LEAVE_REQUEST_OWN",
  async ({ employeeId }, input: RequestLeaveInput) => {
    const request = await createLeaveRequestCore(employeeId, input);
    revalidatePath("/leave");
    return request;
  }
);

/** Submit a DRAFT leave request for approval. */
export const submitLeaveRequest = withRBAC(
  "LEAVE_REQUEST_OWN",
  async ({ employeeId, tenantId }, input: LeaveRequestIdInput) => {
    const { leaveRequestId } = leaveRequestIdSchema.parse(input);
    const updated = await submitLeaveRequestCore(employeeId, tenantId, leaveRequestId);
    revalidatePath("/leave");
    return updated;
  }
);

/** Cancel a leave request (employee self-cancel: DRAFT/PENDING/APPROVED → CANCELLED). */
export const cancelLeaveRequest = withRBAC(
  "LEAVE_REQUEST_OWN",
  async ({ employeeId, tenantId }, input: LeaveRequestIdInput) => {
    const { leaveRequestId } = leaveRequestIdSchema.parse(input);
    const updated = await cancelLeaveRequestCore(employeeId, tenantId, leaveRequestId);
    revalidatePath("/leave");
    revalidatePath("/payroll/timecards");
    revalidatePath("/time/timesheet");
    return updated;
  }
);

// ─── Supervisor / HR actions ──────────────────────────────────────────────────

/** Approve a PENDING leave request. */
export const approveLeaveRequest = withRBAC(
  "LEAVE_APPROVE_TEAM",
  async ({ employeeId: reviewerId, tenantId }, input: ReviewLeaveInput) => {
    const { leaveRequestId, reviewNote } = reviewLeaveSchema.parse(input);

    const request = await db.leaveRequest.findUniqueOrThrow({
      where: { id: leaveRequestId },
    });

    const transition = validateLeaveTransition(request.status, "APPROVE");
    if (!transition.valid) throw new Error(transition.error);

    const updated = await db.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        status: transition.newStatus,
        reviewedAt: new Date(),
        reviewedById: reviewerId,
        reviewNote,
      },
    });

    await writeAuditLog({
      tenantId,
      actorId: reviewerId,
      entityType: "LEAVE_REQUEST",
      entityId: leaveRequestId,
      action: "APPROVED",
      changes: { before: request.status, after: transition.newStatus },
    });

    await syncLeaveSegments(leaveRequestId);

    revalidatePath("/supervisor/leave");
    revalidatePath("/leave");
    revalidatePath("/payroll/timecards");
    revalidatePath("/time/timesheet");
    return updated;
  }
);

/** Reject a PENDING or APPROVED leave request. */
export const rejectLeaveRequest = withRBAC(
  "LEAVE_APPROVE_TEAM",
  async ({ employeeId: reviewerId, tenantId }, input: ReviewLeaveInput) => {
    const { leaveRequestId, reviewNote } = reviewLeaveSchema.parse(input);

    const request = await db.leaveRequest.findUniqueOrThrow({
      where: { id: leaveRequestId },
    });

    const transition = validateLeaveTransition(request.status, "REJECT");
    if (!transition.valid) throw new Error(transition.error);

    const updated = await db.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        status: transition.newStatus,
        reviewedAt: new Date(),
        reviewedById: reviewerId,
        reviewNote,
      },
    });

    await writeAuditLog({
      tenantId,
      actorId: reviewerId,
      entityType: "LEAVE_REQUEST",
      entityId: leaveRequestId,
      action: "REJECTED",
      changes: { before: request.status, after: transition.newStatus },
    });

    await syncLeaveSegments(leaveRequestId);

    revalidatePath("/supervisor/leave");
    revalidatePath("/leave");
    revalidatePath("/payroll/timecards");
    revalidatePath("/time/timesheet");
    return updated;
  }
);

/**
 * Post an APPROVED leave request — debit the balance.
 * Typically called by Payroll when processing a period.
 */
export const postLeaveRequest = withRBAC(
  "LEAVE_APPROVE_ANY",
  async ({ employeeId: actorId, tenantId }, input: LeaveRequestIdInput) => {
    const { leaveRequestId } = leaveRequestIdSchema.parse(input);

    const request = await db.leaveRequest.findUniqueOrThrow({
      where: { id: leaveRequestId },
    });

    const transition = validateLeaveTransition(request.status, "POST");
    if (!transition.valid) throw new Error(transition.error);

    await db.leaveRequest.update({
      where: { id: leaveRequestId },
      data: { status: transition.newStatus, postedAt: new Date() },
    });

    await postLeaveUsage(leaveRequestId);

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "LEAVE_REQUEST",
      entityId: leaveRequestId,
      action: "POSTED",
      changes: { before: request.status, after: transition.newStatus },
    });

    revalidatePath("/supervisor/leave");
    revalidatePath("/leave");
    revalidatePath("/payroll/timecards");
    return { leaveRequestId };
  }
);
