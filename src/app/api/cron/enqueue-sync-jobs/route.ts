import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ROSTER_SYNC_KIND,
  SCHEDULE_PULL_KIND,
  enqueueBridgeJob,
  scheduleWindow,
} from "@/lib/services/bridge.service";

/**
 * Queues the work the bridge will collect on its next pass.
 *
 * <p>This is the only thing on a clock. The bridge polls at its own cadence
 * and CloudTime cannot reach it, so "sync every 15 minutes" is really "leave a
 * job every 15 minutes and let it be collected". A run that queues nothing
 * because the last job is still waiting is the correct outcome, not a fault.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Only tenants that actually have WMS-linked employees. Queueing Oracle work
  // for a tenant with no Oracle presence would give the bridge a query that
  // can only ever return rows nobody can match.
  const tenants = await db.tenant.findMany({
    where: { isActive: true, employees: { some: { wmsId: { not: null } } } },
    select: { id: true, slug: true },
  });

  const window = scheduleWindow();
  const queued: Array<{ tenant: string; kind: string; created: boolean }> = [];

  for (const tenant of tenants) {
    const roster = await enqueueBridgeJob(tenant.id, ROSTER_SYNC_KIND, {});
    queued.push({ tenant: tenant.slug, kind: ROSTER_SYNC_KIND, created: roster.created });

    const schedule = await enqueueBridgeJob(tenant.id, SCHEDULE_PULL_KIND, window);
    queued.push({ tenant: tenant.slug, kind: SCHEDULE_PULL_KIND, created: schedule.created });
  }

  return NextResponse.json({
    tenants: tenants.length,
    created: queued.filter((q) => q.created).length,
    alreadyPending: queued.filter((q) => !q.created).length,
    window,
    queued,
  });
}
