import { NextRequest, NextResponse } from "next/server";
import {
  authenticateMobile,
  requirePermission,
  AuthError,
  ForbiddenError,
} from "@/lib/mobile-auth";
import {
  createLeaveRequestCore,
  submitLeaveRequestCore,
} from "@/lib/services/leave.service";

/** POST — create a leave request and auto-submit it */
export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateMobile(req);
    requirePermission(actor, "LEAVE_REQUEST_OWN");

    const body = await req.json();

    // Create in DRAFT then immediately submit (matches web behavior)
    const request = await createLeaveRequestCore(actor.employeeId, body);
    const submitted = await submitLeaveRequestCore(
      actor.employeeId,
      actor.tenantId,
      request.id,
    );

    return NextResponse.json({
      success: true,
      data: {
        id: submitted.id,
        status: submitted.status,
        startDate: submitted.startDate,
        endDate: submitted.endDate,
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
