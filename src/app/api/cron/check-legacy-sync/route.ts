import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Says out loud when punches CloudTime accepted never reached Oracle.
 *
 * <p><b>Why this exists.</b> Until 155 the tablet waited on Oracle in front of
 * the employee, so a refusal was self-reporting: somebody was standing at the
 * screen reading it. 155 moved that write behind them, which is what made the
 * time clock fast and what makes CloudTime the decider — and it means a refused
 * or undelivered punch now lands on a queue row on one tablet among a dozen,
 * seen by nobody, until it shows up as a missing shift on a timecard.
 *
 * <p>Payroll still runs off Oracle and NovaTime. A punch that CloudTime holds
 * and Oracle does not is not a reporting discrepancy; it is somebody not being
 * paid for a shift they worked. This job is the thing that notices.
 *
 * <p><b>Absence is a finding.</b> Two of the three checks below fire on
 * silence rather than on errors, because the failure this is guarding against
 * does not announce itself: a tablet that has stopped talking to Oracle, or
 * stopped reporting that it did, writes nothing at all. Waiting for a bad row
 * to appear would mean never alerting on the worst case.
 *
 * <p><b>How it signals.</b> A failing cron invocation, which the platform
 * surfaces with nothing configured, plus an email when SendGrid is set up. Same
 * reasoning as check-bridge-health: an alerting path that depends on someone
 * having set a key is off on the day it is needed.
 */

/** A deferred write that has not resolved in this long is not slow, it is stuck. */
const STUCK_MINUTES = 30;

/**
 * How long a tablet that was reporting may go quiet before that is itself the
 * finding. Generously longer than a shift gap so a quiet second shift does not
 * page anybody; short enough that a tablet dead since morning is caught today.
 */
const SILENT_HOURS = 14;

/** Only builds that know how to report can be expected to. */
const REPORTING_FROM_VERSION = 155;

type Finding = { check: string; detail: string };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  const findings: Finding[] = [];
  const since = new Date(now - 24 * 60 * 60 * 1000);

  /* ---- 1. Punches Oracle refused or never took ---- */
  //
  // Minus the refusals that mean the opposite of what they say.
  //
  // Oracle's write can time out on the RESPONSE while the request landed and
  // the punch was created. The queue then retries, correctly — a genuinely
  // lost request has to be — and Oracle refuses the retry as a duplicate of
  // the punch it already holds. Observed on the first live 156 punch, four
  // seconds apart:
  //
  //   attempt 1  RETRYING  "Request timed out"
  //   attempt 2  REFUSED   "Scanned again to quickly ... prevent Duplicates"
  //
  // Read at face value that is a punch missing from Oracle. It is the exact
  // opposite: it is Oracle telling us the punch is already there. Alerting on
  // it would page somebody about a timecard that is correct, and an alert that
  // is wrong on day one is an alert nobody reads by week two.
  //
  // Both conditions are required, because either alone is ambiguous. A prior
  // failed attempt on the same queue row says the punch may already have
  // landed; a duplicate-shaped message says Oracle thinks it has one. A
  // refusal that follows a timeout but cites a different rule — CA2's lunch
  // rule, say — still alerts, because that one really is a punch Oracle
  // refused to keep.
  const refusals = await db.legacySyncLog.findMany({
    where: {
      kind: "PUNCH",
      outcome: { in: ["REFUSED", "FAILED_PERMANENT"] },
      createdAt: { gte: since },
    },
    select: {
      badgeCode: true,
      outcome: true,
      scanTime: true,
      message: true,
      deviceName: true,
      queueRowId: true,
      attemptCount: true,
      employee: { select: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Which of those queue rows had an earlier attempt fail in transit.
  const retriedRows = new Set(
    (
      await db.legacySyncLog.findMany({
        where: {
          kind: "PUNCH",
          outcome: "RETRYING",
          createdAt: { gte: since },
          queueRowId: { not: null },
        },
        select: { deviceName: true, queueRowId: true },
      })
    ).map((r) => `${r.deviceName ?? ""}#${r.queueRowId}`),
  );

  /** Oracle's own duplicate wording, typo and all: "Scanned again to quickly". */
  const looksLikeDuplicate = (message: string | null) =>
    message != null && /duplicat/i.test(message);

  const probablyDelivered = refusals.filter(
    (r) =>
      looksLikeDuplicate(r.message) &&
      retriedRows.has(`${r.deviceName ?? ""}#${r.queueRowId}`),
  );
  const probablySet = new Set(probablyDelivered);
  const broken = refusals.filter((r) => !probablySet.has(r)).slice(0, 50);

  if (broken.length) {
    // Named, not counted. "3 punches failed" sends somebody to a database;
    // the badge and the time sends them to a person and a timecard.
    const detail = broken
      .slice(0, 10)
      .map(
        (r) =>
          `${r.employee?.user?.name ?? r.badgeCode} ${r.scanTime.toISOString()}` +
          ` ${r.outcome}${r.message ? ` (${r.message})` : ""} on ${r.deviceName ?? "?"}`,
      )
      .join("; ");
    findings.push({
      check: "PUNCH_NOT_IN_ORACLE",
      detail:
        `${broken.length} punch(es) in 24h that CloudTime holds and Oracle does not` +
        (broken.length > 10 ? ` (first 10) — ${detail}` : ` — ${detail}`),
    });
  }

  /* ---- 2. Deferred writes still unresolved ---- */
  //
  // A row whose last word was RETRYING, with no SUCCESS or refusal for the same
  // queue row since. The tablet retries every 60 seconds, so half an hour of
  // this is a tablet that cannot reach Oracle at all.
  const stuck = await db.$queryRaw<{ deviceName: string | null; n: bigint }[]>`
    SELECT l."deviceName", count(*) AS n
      FROM legacy_sync_logs l
     WHERE l.outcome = 'RETRYING'
       AND l."createdAt" < now() - (${STUCK_MINUTES} * interval '1 minute')
       AND l."createdAt" >= now() - interval '24 hours'
       AND NOT EXISTS (
             SELECT 1 FROM legacy_sync_logs d
              WHERE d."deviceName" IS NOT DISTINCT FROM l."deviceName"
                AND d."queueRowId" = l."queueRowId"
                AND d.outcome <> 'RETRYING')
     GROUP BY 1 ORDER BY n DESC`;

  if (stuck.length) {
    findings.push({
      check: "DEFERRED_WRITE_STUCK",
      detail: stuck
        .map((r) => `${r.deviceName ?? "(unnamed)"}: ${Number(r.n)} unresolved`)
        .join(", "),
    });
  }

  /* ---- 3. Tablets that were reporting and went quiet ---- */
  //
  // These rows are what a tablet SAYS happened, so a tablet that has stopped
  // saying anything is indistinguishable from one with nothing to say — except
  // that it is still taking scans. That is the comparison made here.
  const silent = await db.$queryRaw<
    { deviceName: string; lastReport: Date | null; scansSince: bigint }[]
  >`
    WITH reporters AS (
      SELECT DISTINCT "deviceName" FROM legacy_sync_logs
       WHERE "deviceName" IS NOT NULL
         AND "createdAt" >= now() - interval '7 days')
    SELECT r."deviceName",
           (SELECT max(l."createdAt") FROM legacy_sync_logs l
             WHERE l."deviceName" = r."deviceName") AS "lastReport",
           (SELECT count(*) FROM scan_events se
             WHERE se."deviceName" = r."deviceName"
               AND se."sourceSlot" = 'LIVE'
               AND se."scanTime" >= now() - (${SILENT_HOURS} * interval '1 hour')) AS "scansSince"
      FROM reporters r`;

  const goneQuiet = silent.filter(
    (r) =>
      Number(r.scansSince) > 0 &&
      (!r.lastReport || now - r.lastReport.getTime() > SILENT_HOURS * 3600_000),
  );

  if (goneQuiet.length) {
    findings.push({
      check: "TABLET_STOPPED_REPORTING",
      detail: goneQuiet
        .map(
          (r) =>
            `${r.deviceName} took ${Number(r.scansSince)} scan(s) but has reported nothing since ` +
            (r.lastReport ? r.lastReport.toISOString() : "ever"),
        )
        .join("; "),
    });
  }

  const body = {
    healthy: findings.length === 0,
    checkedAt: new Date(now).toISOString(),
    reportingFromVersion: REPORTING_FROM_VERSION,
    findings,
    // Reported, never alerted on. These are refusals that follow a timeout on
    // the same queue row and cite a duplicate — Oracle saying it already has
    // the punch. Counted here so a rising number is still visible to anybody
    // reading the output, because a lot of them means Oracle is slow enough to
    // be timing out routinely, which is worth knowing even though no timecard
    // is wrong.
    probablyDelivered: probablyDelivered.length,
  };

  if (findings.length === 0) {
    return NextResponse.json(body);
  }

  console.error(
    "[legacy-sync] UNHEALTHY —",
    findings.map((f) => `${f.check}: ${f.detail}`).join(" | "),
  );

  await notifyIfConfigured(findings);

  return NextResponse.json(body, { status: 500 });
}

/** Best-effort email. The 500 is the signal that always works. */
async function notifyIfConfigured(findings: Finding[]): Promise<void> {
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
      subject: "CloudTime: punches may be missing from Oracle",
      text:
        "Punches recorded in CloudTime have not reached Oracle. Payroll runs off\n" +
        "Oracle and NovaTime, so these are shifts that may not be paid.\n\n" +
        findings.map((f) => `- [${f.check}] ${f.detail}`).join("\n") +
        "\n\nThe full record is the legacy_sync_logs table. Each row carries the\n" +
        "tablet's own queue row id, which matches the id in that device's log.\n",
    });
  } catch (err) {
    console.error("[legacy-sync] alert email failed", err);
  }
}
