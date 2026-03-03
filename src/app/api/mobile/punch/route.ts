import { NextRequest, NextResponse } from "next/server";
import { startOfDay, endOfDay } from "date-fns";
import { db } from "@/lib/db";
import {
  authenticateMobile,
  requirePermission,
  AuthError,
  ForbiddenError,
} from "@/lib/mobile-auth";
import { getCurrentPunchState } from "@/lib/utils/punch-helpers";
import { recordPunchCore } from "@/lib/services/punch.service";

const PUNCH_TRANSITIONS: Record<string, string[]> = {
  OUT: ["CLOCK_IN"],
  WORK: ["CLOCK_OUT", "MEAL_START", "BREAK_START"],
  MEAL: ["MEAL_END"],
  BREAK: ["BREAK_END"],
};

/** GET — current punch state + today's punches */
export async function GET(req: NextRequest) {
  try {
    const actor = await authenticateMobile(req);
    requirePermission(actor, "PUNCH_OWN");

    const now = new Date();
    const [currentState, todayPunches] = await Promise.all([
      getCurrentPunchState(actor.employeeId),
      db.punch.findMany({
        where: {
          employeeId: actor.employeeId,
          punchTime: { gte: startOfDay(now), lte: endOfDay(now) },
          isApproved: true,
          correctedById: null,
        },
        orderBy: { punchTime: "asc" },
        select: {
          id: true,
          punchType: true,
          punchTime: true,
          roundedTime: true,
          stateAfter: true,
          source: true,
          isApproved: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        currentState,
        availableActions: PUNCH_TRANSITIONS[currentState] ?? [],
        todayPunches,
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

/** POST — record a punch */
export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateMobile(req);
    requirePermission(actor, "PUNCH_OWN");

    const body = await req.json();

    const punch = await recordPunchCore(
      {
        employeeId: actor.employeeId,
        tenantId: actor.tenantId,
        source: "MOBILE",
      },
      body,
    );

    return NextResponse.json({
      success: true,
      data: {
        punchId: punch.id,
        punchType: punch.punchType,
        stateAfter: punch.stateAfter,
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
