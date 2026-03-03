import { NextRequest, NextResponse } from "next/server";
import {
  authenticateMobile,
  requirePermission,
  AuthError,
  ForbiddenError,
} from "@/lib/mobile-auth";
import { getLeaveTypesCore } from "@/lib/services/leave.service";

/** GET — active leave types for the tenant */
export async function GET(req: NextRequest) {
  try {
    const actor = await authenticateMobile(req);
    requirePermission(actor, "LEAVE_REQUEST_OWN");

    const types = await getLeaveTypesCore(actor.tenantId);

    return NextResponse.json({
      success: true,
      data: types.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        requiresApproval: t.requiresApproval,
        isPaid: t.isPaid,
      })),
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
