import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { drainWebhookQueue } from "@/lib/webhooks/dispatch";

/**
 * Every minute: sends webhook messages that are due, which after a save means
 * only the ones that did not get through the first time. See
 * lib/webhooks/dispatch for the tries and the wait between them.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await drainWebhookQueue());
}
