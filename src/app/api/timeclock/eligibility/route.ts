import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badgeWhere } from "@/lib/utils/badge-lookup";

/**
 * May this badge scan right now, and who is it?
 *
 * <p>The answer the kiosk currently gets from the legacy `GET employees/{id}`,
 * sourced from CloudTime instead. Nothing calls this yet: the tablets still ask
 * cajaapi, and will until an app build ships that prefers this and falls back.
 * Deployed ahead of that deliberately, so it can be watched against real
 * badges before anything depends on it.
 *
 * <p><b>Why move it at all.</b> The legacy rule for somebody with no shift is
 * "let them through only while Oracle has them showing IN" — which is sound
 * (you should not clock in without a shift, but you must always be able to
 * leave) and is computed from `timestationscanlog`. That table is the one
 * nothing ever resets: a gate reading the same badge twice leaves a phantom
 * open row, and it stays until that person's next badge. On 2026-09-20 that
 * mechanism told 14 of 56 people at NJ299 they were leaving as they arrived.
 *
 * <p>CloudTime applies the same rule to better inputs — its own gate state,
 * which re-anchors nightly and ignores a badge read twice inside a minute —
 * and its schedule, which the bridge refreshes from Oracle every 15 minutes.
 * Measured the same day: of 57 people who scanned at NJ299, 56 had a scheduled
 * workday here and one had a row saying otherwise. None were unknown.
 *
 * <p>Read-only. It decides nothing and writes nothing; a kiosk that cannot
 * reach it is no worse off than today.
 */

export const dynamic = "force-dynamic";

/** Today's date in a site's own zone, as YYYY-MM-DD. */
function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.TIMECLOCK_API_KEY;
  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const badge = (req.nextUrl.searchParams.get("badge") ?? "").trim();
  if (!badge) {
    return NextResponse.json({ success: false, error: "badge is required" }, { status: 400 });
  }

  // Matches either badge form — 6-digit wmsId or 10-digit barcode — which is
  // the lookup the legacy API cannot do, and the reason typing an employee
  // number at the kiosk fails today for anyone on a 10-digit card.
  const employee = await db.employee.findFirst({
    where: badgeWhere(badge),
    select: {
      id: true,
      wmsId: true,
      isActive: true,
      terminatedAt: true,
      user: { select: { name: true } },
      department: { select: { name: true } },
      site: { select: { timezone: true } },
    },
  });

  if (!employee) {
    // Not an error: an unknown badge is a real thing that happens at a reader,
    // and the kiosk needs to say so rather than treat it as a fault.
    return NextResponse.json({ success: true, found: false, badge });
  }

  const timezone = employee.site?.timezone ?? "America/New_York";
  const today = localDate(new Date(), timezone);

  const scheduleDay = await db.scheduleDay.findFirst({
    where: { employeeId: employee.id, workDate: new Date(`${today}T00:00:00.000Z`) },
    select: { isWorkday: true, startTime: true, endTime: true },
  });

  // Presence per CloudTime's own record. Newest row wins outright rather than
  // looking back for an IN: someone whose latest scan is OUT has left, and
  // reaching past it is how a stale arrival keeps somebody "present" for days.
  const lastScan = await db.scanEvent.findFirst({
    where: { employeeId: employee.id, stream: "SECURITY", direction: { in: ["IN", "OUT"] } },
    orderBy: { scanTime: "desc" },
    select: { direction: true, scanTime: true },
  });
  const present = lastScan?.direction === "IN";

  const terminated = !employee.isActive || employee.terminatedAt !== null;

  // The legacy rule, restated: a shift today, or already inside. Order matters
  // only for the reason string — a scheduled person who is also inside is
  // scheduled, not an exception.
  const scheduled = scheduleDay?.isWorkday === true || present;
  const reason = scheduleDay?.isWorkday
    ? "WORKDAY"
    : present
      ? "PRESENT"
      : scheduleDay
        ? "NOT_A_WORKDAY"
        : "NO_SCHEDULE";

  const name = employee.user?.name?.trim() ?? "";
  const space = name.indexOf(" ");

  return NextResponse.json({
    success: true,
    found: true,
    employeeId: employee.id,
    wmsId: employee.wmsId,
    // Split the way the kiosk greets people — first name alone on the result
    // screen — rather than making every caller do it.
    firstName: space > 0 ? name.slice(0, space) : name,
    lastName: space > 0 ? name.slice(space + 1) : "",
    department: employee.department?.name ?? null,
    terminated,
    scheduled,
    /// WORKDAY | PRESENT | NOT_A_WORKDAY | NO_SCHEDULE — why `scheduled` is
    /// what it is, so a kiosk can say something more useful than "no".
    reason,
    shift: scheduleDay?.startTime
      ? { startTime: scheduleDay.startTime, endTime: scheduleDay.endTime }
      : null,
    presence: lastScan ? (present ? "IN" : "OUT") : "UNKNOWN",
    presenceAt: lastScan?.scanTime?.toISOString() ?? null,
    timezone,
    asOf: today,
  });
}
