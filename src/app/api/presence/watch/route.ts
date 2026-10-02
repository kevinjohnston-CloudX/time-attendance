import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRBAC } from "@/lib/rbac/guard";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { canViewSite } from "@/lib/presence/pulse.service";
import { parseWatchEvent, recordWatchEvent, siteOfEvent } from "@/lib/presence/watch.service";
import { errorCode, gateLog } from "@/lib/presence/gate-alert-log";

/**
 * POST /api/presence/watch  { events: [...] }
 *
 * <p>What an open Live Attendance page reports about itself for the gate
 * alert diagnostics (see watch.service.ts): every 30 seconds which building
 * it is on and whether it is in front, and each time a gate alert card
 * appears or goes away. Nothing on screen depends on it, so the page never
 * waits for it and a failure here costs nothing but the record.
 *
 * <p>The same gate as the board: Live Attendance, View, and every building
 * named must be on the viewer's own list; an event about any other building
 * is dropped. Whether the viewer gets the alert is the server's own reading
 * of their permission, never the page's. Answers 204 either way, so it never
 * says which ids or buildings exist.
 */

export const dynamic = "force-dynamic";

/** More than a page ever sends at once: a beat for each stretch and a few cards. */
const MAX_EVENTS = 10;
const MAX_BYTES = 8_000;

const record = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { events: unknown[] }): Promise<number> => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const session = await auth();
    const alerts = !!session?.user && (await userHasPermission(session.user, "PRESENCE_SCHEDULE_ADD"));
    const viewer = { tenantId, employeeId: employeeId || null, alerts };
    let written = 0;
    for (const raw of input.events.slice(0, MAX_EVENTS)) {
      const e = parseWatchEvent(raw);
      if (!e) continue;
      const site = siteOfEvent(e);
      if (site && !(await canViewSite(tenantId, { employeeId, role }, site))) continue;
      await recordWatchEvent(viewer, e);
      written++;
    }
    return written;
  },
);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BYTES) return new NextResponse(null, { status: 204 });
  let events: unknown[] = [];
  try {
    const body = JSON.parse(text) as { events?: unknown };
    if (Array.isArray(body?.events)) events = body.events;
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (events.length === 0) return new NextResponse(null, { status: 204 });
  try {
    const res = await record({ events });
    if (!res.success && res.error === "UNAUTHENTICATED") return new NextResponse(null, { status: 401 });
    if (!res.success && res.error !== "FORBIDDEN" && res.error !== "NOT_FOUND") {
      gateLog("failed", { at: "screen report", error: res.error }, "warn");
    }
  } catch (err) {
    gateLog("failed", { at: "screen report", error: errorCode(err) }, "warn");
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
