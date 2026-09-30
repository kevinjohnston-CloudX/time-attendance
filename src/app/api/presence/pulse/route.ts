import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRBAC } from "@/lib/rbac/guard";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { canViewSite, getSitePulse, type SitePulse } from "@/lib/presence/pulse.service";

/**
 * GET /api/presence/pulse?site=<id>[&alerts=1]
 *
 * <p>What an open Live Attendance page asks every couple of seconds: when the
 * newest scan at this building was recorded, and, for a viewer who gets the
 * gate alert, when today's refusals here last changed (see pulse.service.ts).
 * A route rather than a server action, because the browser runs server
 * actions one at a time and an ask this frequent would hold up every click.
 *
 * <p>The same gate as the board: Live Attendance, View, and a building on the
 * viewer's own list. The refusal time needs the gate alert permission as well
 * and is null without it. A building outside the list answers 404, the same
 * as one that does not exist.
 */

export const dynamic = "force-dynamic";

const pulse = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { siteId: string; alerts: boolean }): Promise<SitePulse> => {
    if (!tenantId || !(await canViewSite(tenantId, { employeeId, role }, input.siteId))) throw new Error("NOT_FOUND");
    let alerts = false;
    if (input.alerts) {
      const session = await auth();
      alerts = !!session?.user && (await userHasPermission(session.user, "PRESENCE_SCHEDULE_ADD"));
    }
    return getSitePulse(tenantId, input.siteId, alerts);
  },
);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const siteId = (req.nextUrl.searchParams.get("site") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(siteId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const res = await pulse({ siteId, alerts: req.nextUrl.searchParams.get("alerts") === "1" });
  const headers = { "Cache-Control": "no-store" };
  if (res.success) return NextResponse.json(res.data, { headers });
  const status = res.error === "UNAUTHENTICATED" ? 401 : res.error === "FORBIDDEN" || res.error === "NOT_FOUND" ? 404 : 500;
  const error = status === 401 ? "Unauthorized" : status === 404 ? "Not found" : res.error;
  return NextResponse.json({ error }, { status, headers });
}
