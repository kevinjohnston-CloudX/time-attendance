import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * How many people clocked in without scanning at security, per building.
 *
 * <p><b>What this is for.</b> The security-first rule can only be switched on
 * at a site where people are already scanning at the gate, and until now there
 * was no way to know that except by switching it on and watching who got turned
 * away. Measured 2026-09-21 at NJ299 — the only site with working readers —
 * 48% of morning clock-ins had a gate IN first. Enforcing there would have
 * refused roughly 550 people in a week, two thirds of whom had no gate scan at
 * all rather than a late one.
 *
 * <p>So a site sits in REPORT while this job counts, and moves to ENFORCE when
 * the count goes quiet. The number is the decision; nobody is turned away to
 * produce it.
 *
 * <p><b>Why only the first scan of a day counts.</b> The rule is about entering
 * the building, and a person enters once. Counting their meal and clock-out
 * scans too would measure the same arrival several times and make a compliant
 * site look worse the longer people work.
 *
 * <p><b>This never fails the invocation.</b> It is a measurement, not an alert.
 * A site at 20% is not an incident — it is the reason the site is still in
 * REPORT. check-legacy-sync is the one that pages.
 */

/** Matches Eligibility.PRESENCE_MAX_AGE_MS on the tablet. */
const PRESENCE_HOURS = 16;

/** A week: long enough to cover every shift pattern, short enough to be current. */
const WINDOW_DAYS = 7;

type SiteRow = {
  site: string;
  mode: string;
  clockIns: number;
  gated: number;
  pct: number;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // One row per person per day: their first time clock scan, and whether a gate
  // IN preceded it inside the presence window.
  const rows = await db.$queryRaw<
    { site: string; mode: string; clockins: bigint; gated: bigint }[]
  >`
    WITH firsts AS (
      SELECT DISTINCT ON (se."employeeId", (se."scanTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date)
             se."employeeId", se."scanTime", s.name AS site, s."gateScanMode"::text AS mode
        FROM scan_events se
        JOIN employees e ON e.id = se."employeeId"
        JOIN sites s ON s.id = e."siteId"
       WHERE se.stream = 'TIME_CLOCK'
         AND se."sourceSlot" = 'LIVE'
         AND se."scanTime" >= (now() AT TIME ZONE 'UTC') - (${WINDOW_DAYS} * interval '1 day')
       ORDER BY se."employeeId",
                (se."scanTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date,
                se."scanTime")
    SELECT site, mode,
           count(*) AS clockins,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM scan_events g
              WHERE g."employeeId" = firsts."employeeId"
                AND g.stream = 'SECURITY'
                AND g.direction = 'IN'
                AND g."scanTime" <= firsts."scanTime"
                AND g."scanTime" >= firsts."scanTime" - (${PRESENCE_HOURS} * interval '1 hour')
           )) AS gated
      FROM firsts
     GROUP BY 1, 2
     ORDER BY clockins DESC`;

  const sites: SiteRow[] = rows.map((r) => {
    const clockIns = Number(r.clockins);
    const gated = Number(r.gated);
    return {
      site: r.site,
      mode: r.mode,
      clockIns,
      gated,
      pct: clockIns ? Math.round((100 * gated) / clockIns) : 0,
    };
  });

  // Who to go and talk to. Named rather than counted, and only for sites that
  // are actually being measured — a list for a building nobody has decided to
  // enforce is noise somebody has to scroll past.
  const measured = sites.filter((s) => s.mode !== "OFF").map((s) => s.site);
  const offenders = measured.length
    ? await db.$queryRaw<
        { site: string; name: string | null; badge: string | null; days: bigint }[]
      >`
        WITH firsts AS (
          SELECT DISTINCT ON (se."employeeId", (se."scanTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date)
                 se."employeeId", se."scanTime", s.name AS site
            FROM scan_events se
            JOIN employees e ON e.id = se."employeeId"
            JOIN sites s ON s.id = e."siteId"
           WHERE se.stream = 'TIME_CLOCK'
             AND se."sourceSlot" = 'LIVE'
             AND s.name = ANY(${measured})
             AND se."scanTime" >= (now() AT TIME ZONE 'UTC') - (${WINDOW_DAYS} * interval '1 day')
           ORDER BY se."employeeId",
                    (se."scanTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date,
                    se."scanTime")
        SELECT f.site, u.name, e."wmsId" AS badge, count(*) AS days
          FROM firsts f
          JOIN employees e ON e.id = f."employeeId"
          LEFT JOIN users u ON u.id = e."userId"
         WHERE NOT EXISTS (
           SELECT 1 FROM scan_events g
            WHERE g."employeeId" = f."employeeId"
              AND g.stream = 'SECURITY'
              AND g.direction = 'IN'
              AND g."scanTime" <= f."scanTime"
              AND g."scanTime" >= f."scanTime" - (${PRESENCE_HOURS} * interval '1 hour'))
         GROUP BY 1, 2, 3
         ORDER BY days DESC, 2
         LIMIT 50`
    : [];

  const body = {
    windowDays: WINDOW_DAYS,
    checkedAt: new Date().toISOString(),
    sites,
    // Only for sites being measured. Empty is the outcome you are aiming for.
    missedGate: offenders.map((o) => ({
      site: o.site,
      name: o.name ?? o.badge ?? "(unknown)",
      badge: o.badge,
      days: Number(o.days),
    })),
  };

  console.log(
    "[gate-compliance] " +
      sites.map((s) => `${s.site} ${s.pct}% (${s.mode})`).join(" | "),
  );

  await notifyIfConfigured(body);

  return NextResponse.json(body);
}

/** Emailed only for sites somebody has put in REPORT or ENFORCE. */
async function notifyIfConfigured(body: {
  sites: SiteRow[];
  missedGate: { site: string; name: string; days: number }[];
}): Promise<void> {
  const measured = body.sites.filter((s) => s.mode !== "OFF");
  if (!measured.length) return;

  const to = process.env.BRIDGE_ALERT_EMAIL;
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!to || !key || !from) return;

  try {
    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(key);
    await sgMail.send({
      to: to.split(",").map((s) => s.trim()).filter(Boolean),
      from,
      subject: "CloudTime: security-scan compliance",
      text:
        "How many people clocked in after scanning at security, last 7 days.\n\n" +
        measured
          .map((s) => `  ${s.site}  ${s.pct}%  (${s.gated}/${s.clockIns})  [${s.mode}]`)
          .join("\n") +
        "\n\nA site is safe to move from REPORT to ENFORCE when its number is\n" +
        "close to 100. Below that, enforcing turns people away at the tablet for\n" +
        "a gap they did not create.\n\n" +
        (body.missedGate.length
          ? "Clocked in without a gate scan:\n" +
            body.missedGate
              .slice(0, 25)
              .map((o) => `  ${o.site}  ${o.name}  ${o.days} day(s)`)
              .join("\n")
          : "Nobody clocked in without a gate scan.") +
        "\n",
    });
  } catch (err) {
    console.error("[gate-compliance] email failed", err);
  }
}
