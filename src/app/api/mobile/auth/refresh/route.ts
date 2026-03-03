import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rotateRefreshToken, AuthError } from "@/lib/mobile-auth";

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "refreshToken is required" },
        { status: 400 },
      );
    }

    const tokens = await rotateRefreshToken(parsed.data.refreshToken);

    return NextResponse.json({
      success: true,
      data: tokens,
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
