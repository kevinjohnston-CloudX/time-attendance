import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bridgeAuthed } from "@/lib/api/bridge-auth";
import {
  BRIDGE_AGENT,
  BRIDGE_JOB_KINDS,
  bridgeHeartbeat,
  reapStaleJobs,
} from "@/lib/services/bridge.service";

/**
 * Poll endpoint for the CloudTime bridge.
 *
 * <p>The bridge, running on a machine inside the WMS network, calls this on
 * its own cadence with the shared secret, takes the pending jobs, and answers
 * each via POST /api/bridge/jobs/[id]. Nothing here ever initiates contact
 * with that machine — no port was opened inwards, and none is needed.
 */

export const dynamic = "force-dynamic";

/** One pass should not hand over more work than it can answer before the next. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function GET(req: Request) {
  const auth = bridgeAuthed(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  await bridgeHeartbeat(BRIDGE_AGENT, req.headers.get("x-bridge-version"));

  // Jobs that waited too long are cleared here rather than on a timer: this is
  // the moment a bridge has just come back, and handing it a backlog of stale
  // windows would delay the one sync that actually matters — the current one.
  await reapStaleJobs();

  const url = new URL(req.url);
  const requested = (url.searchParams.get("kinds") ?? BRIDGE_JOB_KINDS.join(","))
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  // A bridge may only ask for kinds this app actually issues.
  const kinds = requested.filter((k) => (BRIDGE_JOB_KINDS as readonly string[]).includes(k));

  const limit = Math.min(Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT);

  const jobs = await db.bridgeJob.findMany({
    where: { status: "PENDING", kind: { in: kinds } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, kind: true, payload: true, createdAt: true },
  });

  return NextResponse.json({ jobs });
}
