import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  GATE_STATE_DAYS,
  GATE_STATE_PULL_KIND,
  ROSTER_SYNC_KIND,
  SCHEDULE_PULL_KIND,
  enqueueBridgeJob,
  gateStateSeedDue,
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

  // Narrow on most passes, the full -7/+28 sweep once an hour. Only today
  // matters to a gate, and at a 5-minute cadence the wide pull would ask
  // Oracle for 14,450 rows every time to serve a question about ~1,200 of
  // them. The sweep still happens; it just stops being what a person at a
  // door is waiting behind.
  //
  // Keyed off the clock rather than off state so it stays stateless: with a
  // */5 cron this is one full sweep and eleven narrow passes an hour, and a
  // missed tick costs an hour at worst, never a permanent drift.
  const window = scheduleWindow(new Date().getUTCMinutes() < 5 ? "full" : "day");
  const queued: Array<{ tenant: string; kind: string; created: boolean }> = [];

  for (const tenant of tenants) {
    const roster = await enqueueBridgeJob(tenant.id, ROSTER_SYNC_KIND, {});
    queued.push({ tenant: tenant.slug, kind: ROSTER_SYNC_KIND, created: roster.created });

    const schedule = await enqueueBridgeJob(tenant.id, SCHEDULE_PULL_KIND, window);
    queued.push({ tenant: tenant.slug, kind: SCHEDULE_PULL_KIND, created: schedule.created });

    // Daily rather than every pass — see gateStateSeedDue.
    if (await gateStateSeedDue(tenant.id)) {
      const gate = await enqueueBridgeJob(tenant.id, GATE_STATE_PULL_KIND, {
        days: GATE_STATE_DAYS,
      });
      queued.push({ tenant: tenant.slug, kind: GATE_STATE_PULL_KIND, created: gate.created });
    }
  }

  return NextResponse.json({
    tenants: tenants.length,
    created: queued.filter((q) => q.created).length,
    alreadyPending: queued.filter((q) => !q.created).length,
    window,
    queued,
  });
}
