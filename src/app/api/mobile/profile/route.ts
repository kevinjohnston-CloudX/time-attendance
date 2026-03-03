import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateMobile, AuthError } from "@/lib/mobile-auth";

/** GET — employee profile info */
export async function GET(req: NextRequest) {
  try {
    const actor = await authenticateMobile(req);

    const employee = await db.employee.findUniqueOrThrow({
      where: { id: actor.employeeId },
      include: {
        user: { select: { name: true, email: true } },
        site: { select: { id: true, name: true, timezone: true } },
        department: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        userId: actor.userId,
        employeeId: actor.employeeId,
        name: employee.user.name,
        email: employee.user.email,
        role: employee.role,
        site: employee.site,
        department: employee.department,
        hireDate: employee.hireDate,
        jobTitle: employee.jobTitle,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.status },
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
