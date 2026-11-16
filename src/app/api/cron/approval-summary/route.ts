import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { weeklyApprovalSummary } from "@/lib/notify/approval-reminders";

/**
 * Monday morning: one email to each person with approvals still waiting on
 * them, and nothing to anyone else (lib/notify/approval-reminders.ts).
 *
 * <p>The answer holds counts only, never names: it lands in the hosting logs.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const plan = await weeklyApprovalSummary({ send: true });
  return NextResponse.json({ people: plan.length });
}
