"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { validateLeaveTransition } from "@/lib/state-machines/leave-state";
import { postLeaveUsage, reverseLeaveUsage } from "@/lib/engines/accrual-engine";
import { syncLeaveSegments } from "@/lib/engines/leave-segment-builder";
import { writeAuditLog } from "@/lib/audit/logger";
import {
  getLeaveRequestsCore,
  getLeaveTypesCore,
  getLeaveBalancesCore,
  createLeaveRequestCore,
  submitLeaveRequestCore,
  cancelLeaveRequestCore,
  validateBalanceForApproval,
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

/** Cancel a leave request (employee self-cancel: PENDING only — approved requests require supervisor action). */
export const cancelLeaveRequest = withRBAC(
  "LEAVE_REQUEST_OWN",
  async ({ employeeId, tenantId }, input: LeaveRequestIdInput) => {
    const { leaveRequestId } = leaveRequestIdSchema.parse(input);

    const request = await db.leaveRequest.findUniqueOrThrow({
      where: { id: leaveRequestId },
      select: { status: true },
    });

    if (!["DRAFT", "PENDING"].includes(request.status)) {
      throw new Error("Only pending leave requests can be cancelled. Contact your supervisor to cancel an approved request.");
    }

    const updated = await cancelLeaveRequestCore(employeeId, tenantId, leaveRequestId);
    revalidatePath("/leave");
    revalidatePath("/payroll/timecards");
    revalidatePath("/time/timesheet");
    return updated;
  }
);

// ─── Supervisor / HR actions ──────────────────────────────────────────────────

/** Supervisor approves a PENDING leave request — moves it to PENDING_HR for HR review. */
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

    revalidatePath("/supervisor/leave");
    revalidatePath("/leave");
    return updated;
  }
);

/** HR/Payroll approves a PENDING_HR leave request — finalises approval, debits balance, creates segments. */
export const hrApproveLeaveRequest = withRBAC(
  "LEAVE_APPROVE_ANY",
  async ({ employeeId: reviewerId, tenantId }, input: ReviewLeaveInput) => {
    const { leaveRequestId, reviewNote } = reviewLeaveSchema.parse(input);

    const request = await db.leaveRequest.findUniqueOrThrow({
      where: { id: leaveRequestId },
    });

    const transition = validateLeaveTransition(request.status, "APPROVE");
    if (!transition.valid) throw new Error(transition.error);

    await db.leaveRequest.update({
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

    await validateBalanceForApproval(leaveRequestId);
    await postLeaveUsage(leaveRequestId);
    await syncLeaveSegments(leaveRequestId);

    revalidatePath("/supervisor/leave");
    revalidatePath("/leave");
    revalidatePath("/payroll/timecards");
    revalidatePath("/time/timesheet");
    return { success: true as const };
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

/** Reverse an APPROVED leave request back to PENDING, undoing the balance debit. */
export const reverseLeaveApproval = withRBAC(
  "LEAVE_APPROVE_TEAM",
  async ({ employeeId: reviewerId, tenantId }, input: LeaveRequestIdInput) => {
    const { leaveRequestId } = leaveRequestIdSchema.parse(input);

    const request = await db.leaveRequest.findUniqueOrThrow({
      where: { id: leaveRequestId },
    });

    const transition = validateLeaveTransition(request.status, "REVERT");
    if (!transition.valid) throw new Error(transition.error);

    // Undo the balance debit that was posted on approval
    await reverseLeaveUsage(leaveRequestId);

    await db.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        status: transition.newStatus,
        reviewedAt: null,
        reviewedById: null,
        reviewNote: null,
      },
    });

    await writeAuditLog({
      tenantId,
      actorId: reviewerId,
      entityType: "LEAVE_REQUEST",
      entityId: leaveRequestId,
      action: "UPDATED",
      changes: { before: request.status, after: transition.newStatus, note: "Approval reversed to pending" },
    });

    // Remove leave segments — they should not exist while the request is pending
    await syncLeaveSegments(leaveRequestId);

    revalidatePath("/supervisor/leave");
    revalidatePath("/leave");
    revalidatePath("/payroll/timecards");
    revalidatePath("/time/timesheet");
    return { success: true as const };
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
