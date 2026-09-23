import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GATE_SCAN_RECON_KIND, enqueueBridgeJob } from "@/lib/services/bridge.service";

/**
 * Queues a pull of today's gate crossings from Oracle, for the bridge to
 * collect on its next pass.
 *
 * <p>Runs hourly through the working day rather than at a fixed morning and
 * afternoon slot: the crossings it recovers are arrivals at readers CloudTime
 * cannot see, and each one has to be in place before that person's NEXT scan
 * or the direction of that scan is wrong. The sooner after the arrival, the
 * more of the day it protects. The pull itself is cheap — one day of one
 * table.
 *
 * <p>Temporary, like everything under gatescan.recon — see
 * gate-recon.service for why, and for what it deliberately does not take from
 * Oracle.
 */

export const dynamic = "force-dynamic";

/** One day. Anything earlier is ignored on apply; asking for it is waste. */
const RECON_DAYS = 1;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const tenants = await db.tenant.findMany({
    where: { isActive: true, employees: { some: { wmsId: { not: null } } } },
    select: { id: true, slug: true },
  });

  const queued: Array<{ tenant: string; created: boolean }> = [];
  for (const tenant of tenants) {
    const job = await enqueueBridgeJob(tenant.id, GATE_SCAN_RECON_KIND, { days: RECON_DAYS });
    queued.push({ tenant: tenant.slug, created: job.created });
  }

  return NextResponse.json({
    tenants: tenants.length,
    created: queued.filter((q) => q.created).length,
    alreadyPending: queued.filter((q) => !q.created).length,
    queued,
  });
}
