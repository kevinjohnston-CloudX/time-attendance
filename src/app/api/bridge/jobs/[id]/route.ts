import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bridgeAuthed } from "@/lib/api/bridge-auth";
import { applyBridgeAnswer } from "@/lib/services/bridge.service";

/**
 * Answer endpoint for the CloudTime bridge. One POST per job:
 *
 *   { result: { employees: [...] } }   roster answer      -> job DONE, applied
 *   { result: { schedules: [...] } }   schedule answer    -> job DONE, applied
 *   { error: "text" }                  could not be done  -> job FAILED
 *
 * <p>Applying happens inline. The job is marked DONE first, so a second POST
 * for the same job is refused rather than applying the batch twice — the
 * bridge retries on network failure, and a retry that lands after the first
 * call succeeded must not double-apply.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = bridgeAuthed(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

  let body: { result?: unknown; error?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const job = await db.bridgeJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  if (job.status !== "PENDING") {
    return NextResponse.json({ ok: true, note: "already answered" });
  }

  if (body?.error) {
    await db.bridgeJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: String(body.error).slice(0, 2000),
        answeredAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (!body?.result || typeof body.result !== "object") {
    return NextResponse.json({ error: "result or error required" }, { status: 400 });
  }

  // Claim the job before doing the work. Two bridges, or one bridge retrying
  // after a timeout while the first request is still running, then find it no
  // longer PENDING and stop rather than applying twice.
  //
  // The status check above is not enough on its own: both callers can read
  // PENDING before either writes. The claim has to be the conditional write
  // itself, and `count === 0` is how we learn somebody else got there first.
  const claimed = await db.bridgeJob.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: {
      status: "DONE",
      result: body.result as object,
      answeredAt: new Date(),
      attempts: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ ok: true, note: "already answered" });
  }

  try {
    const outcome = await applyBridgeAnswer(job.id, job.tenantId, job.kind, body.result);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The answer arrived and is recorded; what failed is what we did with it.
    // Kept distinct from a FAILED job so the bridge is not blamed for it.
    await db.bridgeJob.update({
      where: { id: job.id },
      data: { error: `applying answer failed: ${message.slice(0, 500)}` },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
