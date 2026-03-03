import { NextRequest, NextResponse } from "next/server";
import {
  authenticateMobile,
  requirePermission,
  AuthError,
  ForbiddenError,
} from "@/lib/mobile-auth";
import {
  getLeaveBalancesCore,
  getLeaveRequestsCore,
} from "@/lib/services/leave.service";

/** GET — leave balances and requests combined */
export async function GET(req: NextRequest) {
  try {
    const actor = await authenticateMobile(req);
    requirePermission(actor, "LEAVE_REQUEST_OWN");

    const [balancesRaw, requestsRaw] = await Promise.all([
      getLeaveBalancesCore(actor.employeeId),
      getLeaveRequestsCore(actor.employeeId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        balances: balancesRaw.map((b) => ({
          id: b.id,
          leaveTypeId: b.leaveTypeId,
          leaveTypeName: b.leaveType.name,
          balanceMinutes: b.balanceMinutes,
          usedMinutes: b.usedMinutes,
        })),
        requests: requestsRaw.map((r) => ({
          id: r.id,
          leaveTypeId: r.leaveTypeId,
          leaveTypeName: r.leaveType.name,
          status: r.status,
          startDate: r.startDate,
          endDate: r.endDate,
          durationMinutes: r.durationMinutes,
          note: r.note,
          reviewNote: r.reviewNote,
          submittedAt: r.submittedAt,
          reviewedAt: r.reviewedAt,
        })),
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.status },
      );
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 403 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
