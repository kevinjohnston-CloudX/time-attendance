import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateMobile,
  revokeRefreshToken,
  AuthError,
} from "@/lib/mobile-auth";

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    await authenticateMobile(req);

    const body = await req.json();
    const parsed = logoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "refreshToken is required" },
        { status: 400 },
      );
    }

    await revokeRefreshToken(parsed.data.refreshToken);

    return NextResponse.json({ success: true });
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
