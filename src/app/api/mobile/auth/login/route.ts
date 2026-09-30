import { NextRequest, NextResponse } from "next/server";
import { WINDOW_MIN, clientAddress, isLockedOut, recordFailedLogin } from "@/lib/login-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { findLoginUserId } from "@/lib/login-lookup";
import { signAccessToken, createRefreshToken } from "@/lib/mobile-auth";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Username and password are required" },
        { status: 400 },
      );
    }

    const userId = await findLoginUserId(parsed.data.username, { username: true });
    const user = userId
      ? await db.user.findUnique({
          where: { id: userId },
          include: { employee: { include: { customRole: { select: { liveAttendanceOnly: true } } } } },
        })
      : null;

    if (!user?.passwordHash) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // The same limit as the web sign-in, checked before the password.
    const address = clientAddress(req.headers);
    if (await isLockedOut(user.id, address)) {
      return NextResponse.json(
        { success: false, error: `Too many attempts. Wait ${WINDOW_MIN} minutes, then try again.` },
        { status: 429 },
      );
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      await recordFailedLogin(user.id, user.employee?.tenantId, address, "mobile");
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // Super admins cannot use the mobile app
    if (user.isSuperAdmin) {
      return NextResponse.json(
        { success: false, error: "Super admin accounts cannot use the mobile app" },
        { status: 403 },
      );
    }

    if (!user.employee) {
      return NextResponse.json(
        { success: false, error: "No employee record linked to this account" },
        { status: 403 },
      );
    }

    if (!user.employee.isActive) {
      return NextResponse.json(
        { success: false, error: "Employee account is inactive" },
        { status: 403 },
      );
    }

    // A role limited to Live Attendance has no punch clock, leave or
    // timesheet, which is everything the mobile app is for.
    if (user.employee.customRole?.liveAttendanceOnly) {
      return NextResponse.json(
        { success: false, error: "This account can only open Live Attendance in the web portal" },
        { status: 403 },
      );
    }

    const tokenPayload = {
      sub: user.id,
      employeeId: user.employee.id,
      role: user.employee.role,
      tenantId: user.employee.tenantId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      createRefreshToken(user.id),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.employee.role,
          employeeId: user.employee.id,
          tenantId: user.employee.tenantId,
        },
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
