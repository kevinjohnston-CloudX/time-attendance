import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { remindTimeOffStartingSoon } from "@/lib/notify/approval-reminders";

/**
 * Once a day: time off still waiting two days before it starts reminds
 * whoever holds it (lib/notify/approval-reminders.ts). Runs once a day on
 * purpose, so each request is reminded once.
 *
 * <p>The answer holds counts only, never names: it lands in the hosting logs.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const plan = await remindTimeOffStartingSoon(new Date(), { send: true });
  return NextResponse.json({ requests: plan.length, people: new Set(plan.flatMap((p) => p.userIds)).size });
}
