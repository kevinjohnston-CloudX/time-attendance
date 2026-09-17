"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { BRIDGE_AGENT, BRIDGE_JOB_KINDS } from "@/lib/services/bridge.service";
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

/** A bridge polling on its normal 60s cadence checks in well inside this. */
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
  "roster.sync": { kind: "ROSTER", label: "Roster", cadence: "every 15 min" },
  "schedule.pull": { kind: "SCHEDULE_PULL", label: "Schedule", cadence: "every 15 min" },
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
