import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { SyncKind } from "@prisma/client";
import { BRIDGE_AGENT, BRIDGE_JOB_KINDS } from "@/lib/services/bridge.service";

/**
 * Says out loud when the WMS bridge has stopped working.
 *
 * <p><b>Why this exists.</b> On 2026-09-17 the bridge ran four jobs by hand,
 * answered all three kinds, and then somebody closed the PowerShell window it
 * was living in. It had never been registered as a scheduled task. Nothing
 * noticed for two days: roster, schedule and gate-state data went stale, the
 * enqueue cron kept queueing work every fifteen minutes into a queue nobody was
 * reading, and the only trace was a `lastSeenAt` column that no code looked at.
 * It was found by someone asking an unrelated question about barcodes.
 *
 * <p>Nothing here fixes the bridge. The point is that a silent stop becomes a
 * loud one, because the failure is invisible rather than difficult: the bridge
 * runs on a machine this app cannot reach, so the absence of contact is the
 * only symptom there will ever be.
 *
 * <p><b>How it signals.</b> A failing cron invocation, which the platform
 * already surfaces without anything being configured. That is deliberate: an
 * alerting path that depends on an API key someone has to set is an alerting
 * path that is off on the day it is needed. If SendGrid and BRIDGE_ALERT_EMAIL
 * are configured the same finding is mailed as well, but the 500 is the part
 * that always works.
 */

/** The bridge polls every 60s. Fifteen missed polls is not a slow cycle. */
const HEARTBEAT_STALE_MINUTES = 15;

/**
 * Jobs are reaped after 90 minutes — but only when the bridge polls, since that
 * is where reapStaleJobs runs. So a job still PENDING past that window means
 * nothing has polled, which is the same illness the heartbeat reports and is
 * worth reporting separately because it names which kinds are backing up.
 */
const JOB_STUCK_MINUTES = 90;

/** A kind that has not completed in a day is stale however healthy it looks. */
const SYNC_STALE_HOURS = 24;

/** Runs every 5 minutes, so six failures in a row is half an hour of nothing. */
const CONSECUTIVE_FAILURES = 6;

/** Tomorrow's schedules are judged in the zone most sites run in. */
const SCHEDULE_ZONE = "America/New_York";
/** Oracle writes tomorrow around 21:00 ET; from 22:00 it should be there. */
const SCHEDULE_CHECK_FROM_HOUR = 22;
/** Tomorrow with under half of today's rows is a sync that has stopped. */
const SCHEDULE_MIN_SHARE = 0.5;

type Finding = { check: string; detail: string };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  const findings: Finding[] = [];

  /* ---- 1. Is the bridge talking to us at all? ---- */
  const agent = await db.bridgeAgent.findUnique({
    where: { name: BRIDGE_AGENT },
    select: { lastSeenAt: true, version: true },
  });

  // Nullable in the schema: a row can exist for an agent that has been
  // registered but has never successfully authenticated, and "registered but
  // silent" is exactly as broken as "absent".
  const lastSeenAt = agent?.lastSeenAt ?? null;
  const heartbeatAgeMin = lastSeenAt
    ? Math.round((now - lastSeenAt.getTime()) / 60_000)
    : null;

  if (!agent || !lastSeenAt) {
    findings.push({
      check: "heartbeat",
      detail: `No bridge agent named '${BRIDGE_AGENT}' has ever called in.`,
    });
  } else if (heartbeatAgeMin !== null && heartbeatAgeMin > HEARTBEAT_STALE_MINUTES) {
    findings.push({
      check: "heartbeat",
      detail:
        `Last contact ${heartbeatAgeMin} min ago (${lastSeenAt.toISOString()}), ` +
        `threshold ${HEARTBEAT_STALE_MINUTES}. The agent is not polling: check the ` +
        `CloudTime-wms-bridge scheduled task and C:\\cloudtime-bridge\\logs.`,
    });
  }

  /* ---- 2. Is work piling up uncollected? ---- */
  const stuckCutoff = new Date(now - JOB_STUCK_MINUTES * 60_000);
  const stuck = await db.bridgeJob.groupBy({
    by: ["kind"],
    where: { status: "PENDING", createdAt: { lt: stuckCutoff } },
    _count: { _all: true },
    _min: { createdAt: true },
  });

  for (const s of stuck) {
    const oldestMin = s._min.createdAt
      ? Math.round((now - s._min.createdAt.getTime()) / 60_000)
      : 0;
    findings.push({
      check: "stuck-jobs",
      detail:
        `${s._count._all} '${s.kind}' job(s) still PENDING, oldest ${oldestMin} min. ` +
        `Nothing has collected them.`,
    });
  }

  /* ---- 3. Is it polling but never finishing? ---- */
  // Distinct from the two above: the agent can be alive and taking jobs while
  // every one of them fails, which leaves the heartbeat fresh and the queue
  // empty and the data just as stale.
  const syncStaleCutoff = new Date(now - SYNC_STALE_HOURS * 3_600_000);
  const lastGood = await db.syncRun.groupBy({
    by: ["kind"],
    where: { status: { in: ["SUCCEEDED", "PARTIAL"] } },
    _max: { startedAt: true },
  });
  const lastGoodByKind = new Map(lastGood.map((r) => [r.kind as string, r._max.startedAt]));

  // Job kinds are dotted ("roster.sync"); SyncRun kinds are the enum (ROSTER).
  const KIND_TO_SYNC: Record<string, SyncKind> = {
    "roster.sync": "ROSTER",
    "schedule.pull": "SCHEDULE_PULL",
    "gatestate.pull": "GATE_STATE",
  };

  for (const jobKind of BRIDGE_JOB_KINDS) {
    const syncKind = KIND_TO_SYNC[jobKind];
    if (!syncKind) continue;
    const at = lastGoodByKind.get(syncKind);
    if (!at) {
      findings.push({ check: "sync-stale", detail: `${syncKind} has never completed.` });
    } else if (at < syncStaleCutoff) {
      const hrs = Math.round((now - at.getTime()) / 3_600_000);
      findings.push({
        check: "sync-stale",
        detail: `${syncKind} last completed ${hrs}h ago (${at.toISOString()}), threshold ${SYNC_STALE_HOURS}h.`,
      });
    }
  }

  /* ---- 4. Is one kind failing on every run right now? ---- */
  // Check 3 waits a whole day. On 2026-09-29 the schedule pull failed on every
  // run from 09:25 ET, and check 3 would only have spoken at 09:20 the next
  // morning, after the gates had already refused the morning shift. Six failed
  // runs in a row (half an hour at the 5-minute cadence) is not a blip.
  for (const syncKind of Object.values(KIND_TO_SYNC)) {
    const recent = await db.syncRun.findMany({
      where: { kind: syncKind },
      orderBy: { startedAt: "desc" },
      take: CONSECUTIVE_FAILURES,
      select: { status: true, startedAt: true, error: true },
    });
    if (recent.length === CONSECUTIVE_FAILURES && recent.every((r) => r.status === "FAILED")) {
      const lastLine =
        (recent[0].error ?? "").trim().split("\n").filter(Boolean).pop() ?? "no error text";
      findings.push({
        check: "sync-failing",
        detail:
          `${syncKind}: the last ${CONSECUTIVE_FAILURES} runs all FAILED ` +
          `(latest ${recent[0].startedAt.toISOString()}): ${lastLine.slice(0, 200)}`,
      });
    }
  }

  /* ---- 5. Will the gates have schedules tomorrow morning? ---- */
  // The gate refuses anyone without a schedule_days row for the day, so a
  // missing tomorrow is an outage at the first shift even when every sync
  // "succeeded". Oracle writes day D's rows around 21:00 ET on D-1 and the
  // row count is steady (about 750, weekends included), so late in the
  // evening tomorrow should look like today.
  const etHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: SCHEDULE_ZONE, hour: "2-digit", hourCycle: "h23" })
      .format(new Date(now)),
  );
  if (etHour >= SCHEDULE_CHECK_FROM_HOUR) {
    const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: SCHEDULE_ZONE }).format(new Date(now));
    const today = new Date(`${todayIso}T00:00:00.000Z`);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const [todayRows, tomorrowRows] = await Promise.all([
      db.scheduleDay.count({ where: { workDate: today } }),
      db.scheduleDay.count({ where: { workDate: tomorrow } }),
    ]);
    if (todayRows > 0 && tomorrowRows < todayRows * SCHEDULE_MIN_SHARE) {
      findings.push({
        check: "schedule-tomorrow",
        detail:
          `Only ${tomorrowRows} schedule rows for ${tomorrow.toISOString().slice(0, 10)} ` +
          `against ${todayRows} for today. Without them the gates refuse people ` +
          `tomorrow morning. Check the latest SCHEDULE_PULL runs in sync_runs.`,
      });
    }
  }

  const healthy = findings.length === 0;
  const body = {
    healthy,
    checkedAt: new Date(now).toISOString(),
    agent: agent
      ? {
          name: BRIDGE_AGENT,
          version: agent.version,
          lastSeenAt: lastSeenAt?.toISOString() ?? null,
          ageMinutes: heartbeatAgeMin,
        }
      : null,
    findings,
  };

  if (healthy) {
    return NextResponse.json(body);
  }

  // console.error puts it in the platform's log at error level; the 500 makes
  // the invocation itself show as failed. Two places, neither needing setup.
  console.error(
    "[bridge-health] UNHEALTHY —",
    findings.map((f) => `${f.check}: ${f.detail}`).join(" | "),
  );

  await notifyIfConfigured(findings);

  return NextResponse.json(body, { status: 500 });
}

/**
 * Best-effort email, and deliberately best-effort: a failure to send must not
 * swallow the 500, which is the signal that always works.
 */
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
      subject: "CloudTime: WMS bridge is not healthy",
      text:
        "The bridge between CloudTime and Oracle has stopped working as expected.\n\n" +
        findings.map((f) => `- [${f.check}] ${f.detail}`).join("\n") +
        "\n\nThe bridge runs as the CloudTime-wms-bridge scheduled task on the WMS " +
        "machine. Its log is C:\\cloudtime-bridge\\logs\\.\n",
    });
  } catch (err) {
    console.error("[bridge-health] alert email failed", err);
  }
}
