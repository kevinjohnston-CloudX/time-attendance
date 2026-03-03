import { NextRequest, NextResponse } from "next/server";
import {
  authenticateMobile,
  requirePermission,
  AuthError,
  ForbiddenError,
} from "@/lib/mobile-auth";
import { cancelLeaveRequestCore } from "@/lib/services/leave.service";

/** POST — cancel a leave request (DRAFT/PENDING/APPROVED) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await authenticateMobile(req);
    requirePermission(actor, "LEAVE_REQUEST_OWN");

    const { id } = await params;
    const updated = await cancelLeaveRequestCore(
      actor.employeeId,
      actor.tenantId,
      id,
    );

    return NextResponse.json({
      success: true,
      data: { id: updated.id, status: updated.status },
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
