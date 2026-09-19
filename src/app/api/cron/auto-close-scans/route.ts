import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { snapToLocalTime } from "@/lib/utils/date";

/**
 * Closes the scan log for anyone left showing IN on the time clock at 23:00
 * local, and records that it was this job that did it.
 *
 * <p>Scheduled twice — 03:00 UTC and 07:00 UTC — which is 23:00 Eastern and
 * 23:00 Pacific. Each run only closes employees whose OWN site clock has passed
 * 23:00, so a site is closed at its own eleven o'clock rather than somebody
 * else's. Adding a site in a further zone means adding a schedule, not changing
 * this code.
 *
 * <p><b>Both streams.</b> The buildings are shut by this hour, so anyone either
 * system still shows as present did not scan out rather than is still there.
 *
 * <p>Measured over two months of production logs. On the time clock, of 1,044
 * employees still showing IN at 23:00, every single one had simply never clocked
 * out — not one clocked out later. At the gate, 686 badges appear to exit after
 * 23:00, which looks like night shift until the durations are read: the median
 * such "visit" is 23.8 hours and 262 of them exceed a full day. They are morning
 * arrivals that were never closed, paired by the legacy system with the badge's
 * NEXT arrival — a phantom presence, not a person in the building. Closing them
 * at 23:00 is what makes the on-site list mean something.
 *
 * <p><b>This does not create a Punch and does not touch pay.</b> Timecards have
 * their own sweep in {@code /api/cron/auto-clock-out}, which writes a SYSTEM
 * CLOCK_OUT punch. This one writes only to {@code scan_events}, whose job is to
 * be an independent record of what happened at the readers. Rows it writes are
 * marked AUTO_CLOSE precisely so they are never mistaken for someone having
 * actually badged out.
 *
 * <p>Idempotent: the row is stamped at 23:00 local with sourceSlot
 * 'AUTO_CLOSE', so the unique key (badgeCode, stream, scanTime, sourceSlot)
 * makes a second run for the same night a no-op.
 */

/**
 * Headroom for a first run after a backlog, when `pending` is thousands rather
 * than the nightly ninety. The default limit is what killed the previous
 * version mid-loop, and a sweep that half-runs is worse than one that fails:
 * it reports success and leaves no sign that anyone was missed.
 */
export const maxDuration = 60;

/** The site-local calendar date of `now`, as YYYY-MM-DD. */
function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

const CLOSE_AT_HOUR = 23;

/**
 * The most recent {@link CLOSE_AT_HOUR}:00 local that has already passed.
 *
 * Deliberately not "is it 23:00 right now". A fixed UTC schedule lands on a
 * different local hour in every zone and shifts again at every DST change, so an
 * hour test silently does nothing for half the estate: 07:00 UTC is 00:00 in
 * Los Angeles, which is past 23:00 but reads as hour 0 and would skip the whole
 * site. Asking for the last boundary that has passed is correct whenever the job
 * happens to run, and stamps the same instant on a re-run, which is what makes
 * it idempotent against the unique key.
 */
function lastCloseBoundary(now: Date, timezone: string): Date {
  const todaysBoundary = snapToLocalTime(`${CLOSE_AT_HOUR}:00`, localDate(now, timezone), timezone);
  if (todaysBoundary <= now) return todaysBoundary;

  // 23:00 has not arrived yet locally, so the live boundary is yesterday's.
  // Taken from the local date 24h back rather than by subtracting a day from the
  // boundary, so a DST shift in between cannot land it on the wrong hour.
  const yesterday = localDate(new Date(now.getTime() - 24 * 60 * 60 * 1000), timezone);
  return snapToLocalTime(`${CLOSE_AT_HOUR}:00`, yesterday, timezone);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();

  // Newest scan per employee PER STREAM. DISTINCT ON over (employeeId, stream)
  // because the two are independent states — someone can be shut out of the
  // building while the time clock still thinks they are on shift, and each needs
  // closing on its own terms.
  //
  // The IN test is a filter on the RESULT of the DISTINCT ON, never inside it.
  // Pushing `direction = 'IN'` down into the scan would match any earlier IN and
  // so reach employees who have since scanned out — the exact mistake the
  // original loop existed to avoid. The window still has to be computed first;
  // only then is it asked whether the newest row is an IN.
  const open = await db.$queryRaw<
    Array<{
      employeeId: string;
      tenantId: string | null;
      badgeCode: string;
      stream: "TIME_CLOCK" | "SECURITY";
      scanTime: Date;
      direction: string;
      site: string | null;
      timezone: string | null;
      name: string | null;
    }>
  >`
    WITH latest AS (
      SELECT DISTINCT ON (s."employeeId", s."stream")
             s."employeeId", s."tenantId", s."badgeCode",
             s."stream"::text AS "stream", s."scanTime",
             s."direction"::text AS "direction", s."site"
      FROM   "scan_events" s
      WHERE  s."employeeId" IS NOT NULL
      ORDER  BY s."employeeId", s."stream", s."scanTime" DESC
    )
    SELECT l."employeeId", l."tenantId", l."badgeCode", l."stream",
           l."scanTime", l."direction", l."site",
           si."timezone", u."name"
    FROM   latest l
    JOIN   "employees" e  ON e."id" = l."employeeId"
    LEFT   JOIN "sites" si ON si."id" = e."siteId"
    LEFT   JOIN "users" u  ON u."id" = e."userId"
    WHERE  l."direction" = 'IN'
  `;

  let closed = 0;
  let notYetLocalEleven = 0;
  const alreadyOut = 0;
  let duplicate = 0;
  let errors = 0;
  const closedFor: Array<{
    badgeCode: string; name: string | null; stream: string; since: string;
  }> = [];
  const closedByStream: Record<string, number> = {};
  const pending: Prisma.ScanEventCreateManyInput[] = [];

  for (const row of open) {
    const timezone = row.timezone ?? "America/New_York";
    const closeAt = lastCloseBoundary(now, timezone);

    // Still inside the current day: they badged in after the last 23:00, so
    // their day is in progress. Closing them would stamp an exit before their
    // own arrival. Computed per row because closeAt is the employee's OWN
    // site's eleven o'clock, not this server's.
    if (row.scanTime >= closeAt) {
      notYetLocalEleven++;
      continue;
    }

    pending.push({
      tenantId: row.tenantId,
      employeeId: row.employeeId,
      badgeCode: row.badgeCode,
      stream: row.stream,
      direction: "OUT",
      directionSource: "AUTO_CLOSE",
      scanTime: closeAt,
      site: row.site,
      sourceSlot: "AUTO_CLOSE",
      outcome: "NOT_APPLICABLE",
      note:
        `auto-closed at ${CLOSE_AT_HOUR}:00 ${timezone}: ${row.stream} still ` +
        `showing IN from ${row.scanTime.toISOString()} with no exit scan`,
    });

    closedByStream[row.stream] = (closedByStream[row.stream] ?? 0) + 1;
    if (closedFor.length < 200) {
      closedFor.push({
        badgeCode: row.badgeCode,
        name: row.name,
        stream: row.stream,
        since: row.scanTime.toISOString(),
      });
    }
  }

  // One round trip per chunk instead of one per employee. The previous version
  // awaited a create() inside the loop, so a night with ninety stragglers meant
  // ninety sequential round trips; the function hit its time limit partway and
  // still returned success, closing whoever happened to come first and silently
  // leaving the rest open. That is what left 90 people showing IN across two
  // scheduled runs on 2026-09-18.
  //
  // skipDuplicates replaces the per-row P2002 catch and keeps the same
  // guarantee: the unique key (badgeCode, stream, scanTime, sourceSlot) makes a
  // second run for the same night a no-op, now without a failed insert per row.
  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK);
    try {
      const { count } = await db.scanEvent.createMany({ data: chunk, skipDuplicates: true });
      closed += count;
      duplicate += chunk.length - count;
    } catch (error) {
      errors += chunk.length;
      console.error(
        `auto-close-scans: chunk ${i}-${i + chunk.length} failed`,
        chunk.map((c) => c.badgeCode),
        error,
      );
    }
  }

  return NextResponse.json({
    // False when anything was left unclosed, so a partial sweep is visible to
    // whatever is watching instead of reading as a clean run — the failure mode
    // that hid this bug for two nights.
    success: errors === 0 && closed + duplicate === pending.length,
    ranAt: now.toISOString(),
    // Employees whose newest scan is IN. No longer the whole estate: the
    // direction filter moved into SQL, so this is the candidate count.
    examined: open.length,
    attempted: pending.length,
    closed,
    closedByStream,
    alreadyOut,
    skippedNotYetLocalEleven: notYetLocalEleven,
    skippedAlreadyClosed: duplicate,
    errors,
    closedFor,
  });
}
