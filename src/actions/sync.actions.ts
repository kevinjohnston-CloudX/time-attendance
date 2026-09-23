"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import {
  BRIDGE_AGENT,
  BRIDGE_JOB_KINDS,
  ROSTER_SYNC_KIND,
  SCHEDULE_PULL_KIND,
  enqueueBridgeJob,
  scheduleWindow,
} from "@/lib/services/bridge.service";
import type { SyncKind } from "@prisma/client";

/**
 * Status of the Oracle sync, for the admin page.
 *
 * <p><b>Why this exists.</b> The bridge runs unattended on a VM nobody logs
 * into, and CloudTime cannot reach it — every exchange is started by the
 * bridge. So from in here, "synced and nothing changed" and "has not run since
 * Tuesday" look identical: an empty queue and no new rows. The only thing that
 * tells them apart is the agent's own check-in, which is what the dot on this
 * page reads. Without it the first symptom of a dead bridge is somebody's badge
 * failing at a gate.
 *
 * <p>Deliberately mirrors the CXT ticketing bridge's "WMS routing" panel — the
 * same green/amber/red check-in dot and the same waiting/answered/failed
 * counts — because it is the same bridge pattern on the same VM and there
 * should be one thing to learn, not two.
 */

/** A bridge polling on its normal cadence checks in well inside this. */
const HEALTHY_MINUTES = 3;
/** Beyond this, something is wrong rather than merely slow. */
const STALE_MINUTES = 15;

export type BridgeHealth = "HEALTHY" | "SLOW" | "STALE" | "NEVER";

export type KindSummary = {
  kind: SyncKind;
  lastRunAt: Date | null;
  status: string | null;
  received: number;
  applied: number;
  skipped: number;
  rejected: number;
  error: string | null;
};

/** Which bridge job kind produces which sync run, for the per-kind rows. */
const KIND_LABELS: Record<string, { kind: SyncKind; label: string; cadence: string }> = {
  "roster.sync": { kind: "ROSTER", label: "Roster", cadence: "every 5 min" },
  "schedule.pull": { kind: "SCHEDULE_PULL", label: "Schedule", cadence: "every 5 min" },
  "gatestate.pull": { kind: "GATE_STATE", label: "Gate baseline", cadence: "daily" },
};

export const getWmsSyncStatus = withRBAC("EMPLOYEE_MANAGE", async ({ tenantId }) => {
  const t = tenantId ?? undefined;
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60_000);

  const agent = await db.bridgeAgent.findUnique({
    where: { name: BRIDGE_AGENT },
    select: { lastSeenAt: true, version: true },
  });

  const minutesSinceSeen = agent?.lastSeenAt
    ? (now - agent.lastSeenAt.getTime()) / 60_000
    : null;

  const health: BridgeHealth =
    minutesSinceSeen === null
      ? "NEVER"
      : minutesSinceSeen <= HEALTHY_MINUTES
        ? "HEALTHY"
        : minutesSinceSeen <= STALE_MINUTES
          ? "SLOW"
          : "STALE";

  const [pending, done7d, failed7d] = await Promise.all([
    db.bridgeJob.count({ where: { tenantId: t, status: "PENDING" } }),
    db.bridgeJob.count({ where: { tenantId: t, status: "DONE", createdAt: { gte: sevenDaysAgo } } }),
    db.bridgeJob.count({ where: { tenantId: t, status: "FAILED", createdAt: { gte: sevenDaysAgo } } }),
  ]);

  // The most recent run of each kind, so a leg that has quietly stopped while
  // the others keep going is visible. A single "last sync" timestamp would
  // hide exactly that.
  const kinds = await Promise.all(
    BRIDGE_JOB_KINDS.map(async (jobKind) => {
      const meta = KIND_LABELS[jobKind];
      const run = await db.syncRun.findFirst({
        where: { tenantId: t, kind: meta.kind },
        orderBy: { startedAt: "desc" },
        select: {
          startedAt: true, status: true, received: true,
          applied: true, skipped: true, rejected: true, error: true,
        },
      });
      return {
        ...meta,
        lastRunAt: run?.startedAt ?? null,
        status: run?.status ?? null,
        received: run?.received ?? 0,
        applied: run?.applied ?? 0,
        skipped: run?.skipped ?? 0,
        rejected: run?.rejected ?? 0,
        error: run?.error ?? null,
      };
    }),
  );

  // The two queues a human is expected to work: people Oracle knows and
  // CloudTime does not, and days the two systems disagree about.
  const [candidates, conflicts, topCandidates] = await Promise.all([
    db.rosterCandidate.count({ where: { tenantId: t, status: "NEW" } }),
    db.scheduleDay.count({ where: { tenantId: t, syncState: "CONFLICT" } }),
    db.rosterCandidate.findMany({
      where: { tenantId: t, status: "NEW" },
      orderBy: { failedScans: "desc" },
      take: 10,
      select: {
        oracleEmpId: true, name: true, barcode: true,
        departmentName: true, failedScans: true, firstSeenAt: true,
      },
    }),
  ]);

  const recentRuns = await db.syncRun.findMany({
    where: { tenantId: t },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      id: true, kind: true, status: true, startedAt: true, finishedAt: true,
      received: true, applied: true, skipped: true, rejected: true, error: true,
    },
  });

  return {
    agentName: BRIDGE_AGENT,
    lastSeenAt: agent?.lastSeenAt ?? null,
    version: agent?.version ?? null,
    health,
    pending,
    done7d,
    failed7d,
    kinds,
    candidates,
    conflicts,
    topCandidates,
    recentRuns,
  };
});

/**
 * Queue a roster and schedule pull now, instead of waiting for the cron.
 *
 * <p><b>Why this can exist, when this page says a sync cannot be started from
 * here.</b> Both are true; they are not the same claim. CloudTime still cannot
 * reach the VM — nothing here opens a connection to Oracle or to the bridge,
 * and this returns before any Oracle work has happened. What it does is put a
 * job in the queue the bridge is already polling, which drops the wait from
 * "up to the cron interval, then a poll" to "one poll".
 *
 * <p>That is the whole value of it. Somebody added to `dailyworkerschedule` in
 * Oracle is invisible to a gate reading CloudTime's copy until the next pull:
 * on 2026-09-22 an employee added that morning could not badge in, and the only
 * answer available was to wait. Measured end to end the same day — queued
 * 16:28:17, schedule answered 16:29:33 — 76 seconds, nearly all of it the
 * bridge's 60s poll.
 *
 * <p>Enqueues the roster as well as the schedule. Someone put on a shift this
 * morning is often also new to `framewrk.users`, and a schedule row for an
 * employee CloudTime has never heard of has nothing to attach itself to.
 *
 * <p>Safe to press repeatedly: {@link enqueueBridgeJob} hands back the existing
 * job when one of that kind is already PENDING, so a second press inside the
 * same poll window queues nothing and says so rather than piling up work.
 */
export const requestWmsSync = withRBAC("EMPLOYEE_MANAGE", async ({ tenantId }) => {
  if (!tenantId) {
    return { queued: [] as string[], alreadyPending: [] as string[] };
  }

  const queued: string[] = [];
  const alreadyPending: string[] = [];

  const roster = await enqueueBridgeJob(tenantId, ROSTER_SYNC_KIND, {});
  (roster.created ? queued : alreadyPending).push(ROSTER_SYNC_KIND);

  const schedule = await enqueueBridgeJob(tenantId, SCHEDULE_PULL_KIND, scheduleWindow("day"));
  (schedule.created ? queued : alreadyPending).push(SCHEDULE_PULL_KIND);

  return { queued, alreadyPending };
});
