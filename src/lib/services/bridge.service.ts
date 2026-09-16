import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { applyRosterBatch, type RosterRow } from "@/lib/services/roster-sync.service";
import {
  applyScheduleBatch,
  type OracleScheduleRow,
} from "@/lib/services/schedule-sync.service";
import {
  startSyncRun,
  finishSyncRun,
  failSyncRun,
  SyncTally,
  type SyncDetail,
} from "@/lib/services/sync-run.service";

/**
 * The work CloudTime asks the bridge to do, and what it does with the answers.
 *
 * <p>Oracle sits on a network this app cannot reach and no port was opened
 * inwards, so nothing here ever initiates contact. CloudTime writes a job row;
 * the bridge — running inside that network — collects it on its next pass,
 * runs one read-only query, and posts the answer back over its own outbound
 * connection. A job nobody collects simply waits, so a bridge outage delays a
 * sync instead of failing one.
 */

export const BRIDGE_AGENT = "cloudtime-wms";

export const ROSTER_SYNC_KIND = "roster.sync";
export const SCHEDULE_PULL_KIND = "schedule.pull";
export const BRIDGE_JOB_KINDS = [ROSTER_SYNC_KIND, SCHEDULE_PULL_KIND] as const;

/**
 * How long a schedule window to ask for. Backwards far enough to pick up a
 * retroactive change to a day already worked; forwards far enough that the
 * rota is visible before anybody is standing at a gate.
 */
export const SCHEDULE_DAYS_BACK = 7;
export const SCHEDULE_DAYS_FORWARD = 28;

/**
 * A job older than this was never going to be answered — the bridge was down
 * long enough that the data it would have returned is stale anyway. Reaping
 * them keeps the queue from handing a restarted bridge a pile of history to
 * work through before it gets to today.
 */
const STALE_JOB_MINUTES = 90;

export async function bridgeHeartbeat(name: string, version?: string | null): Promise<void> {
  await db.bridgeAgent.upsert({
    where: { name },
    update: { lastSeenAt: new Date(), ...(version ? { version } : {}) },
    create: { name, lastSeenAt: new Date(), version: version ?? null },
  });
}

/**
 * Queues one job, unless an unanswered one of the same kind is already
 * waiting.
 *
 * <p>The guard matters because the scheduler fires on a fixed cadence whether
 * or not the bridge is keeping up. Without it, an hour of bridge downtime
 * would leave four identical roster jobs queued, and the bridge would come
 * back and run the same expensive query four times to reach the same answer.
 */
export async function enqueueBridgeJob(
  tenantId: string,
  kind: string,
  payload: Prisma.InputJsonValue,
): Promise<{ id: string; created: boolean }> {
  const pending = await db.bridgeJob.findFirst({
    where: { tenantId, kind, status: "PENDING" },
    select: { id: true },
  });
  if (pending) return { id: pending.id, created: false };

  const job = await db.bridgeJob.create({
    data: { tenantId, kind, payload },
    select: { id: true },
  });
  return { id: job.id, created: true };
}

/** The date window a schedule pull should ask Oracle for. */
export function scheduleWindow(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - SCHEDULE_DAYS_BACK);
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + SCHEDULE_DAYS_FORWARD);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

export async function reapStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_JOB_MINUTES * 60_000);
  const result = await db.bridgeJob.updateMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    data: { status: "FAILED", error: `Not collected within ${STALE_JOB_MINUTES} minutes` },
  });
  return result.count;
}

/* ------------------------------------------------------------------ */
/* Acting on an answer                                                 */
/* ------------------------------------------------------------------ */

export type ApplyOutcome = {
  runId: string;
  status: string;
  received: number;
  applied: number;
  skipped: number;
  rejected: number;
  details: SyncDetail[];
};

/**
 * Turns a bridge answer into applied data.
 *
 * <p>Called inline from the answer endpoint. The job is marked DONE before
 * this runs and `processedAt` only after, so a job that was answered but whose
 * application crashed is distinguishable from one that completed — and a
 * duplicate POST is refused by the endpoint rather than applying twice.
 */
export async function applyBridgeAnswer(
  jobId: string,
  tenantId: string,
  kind: string,
  result: unknown,
): Promise<ApplyOutcome> {
  if (kind === ROSTER_SYNC_KIND) {
    const rows = extractRows<RosterRow>(result, "employees");
    return runAndRecord(jobId, tenantId, "ROSTER", () => applyRosterBatch(tenantId, rows));
  }

  if (kind === SCHEDULE_PULL_KIND) {
    const rows = extractRows<OracleScheduleRow>(result, "schedules");
    return runAndRecord(jobId, tenantId, "SCHEDULE_PULL", () =>
      applyScheduleBatch(tenantId, rows),
    );
  }

  throw new Error(`Unknown bridge job kind: ${kind}`);
}

function extractRows<T>(result: unknown, key: string): T[] {
  if (!result || typeof result !== "object") return [];
  const rows = (result as Record<string, unknown>)[key];
  return Array.isArray(rows) ? (rows as T[]) : [];
}

async function runAndRecord(
  jobId: string,
  tenantId: string,
  syncKind: "ROSTER" | "SCHEDULE_PULL",
  work: () => Promise<SyncTally>,
): Promise<ApplyOutcome> {
  const runId = await startSyncRun(tenantId, syncKind, BRIDGE_AGENT);
  try {
    const tally = await work();
    await finishSyncRun(runId, tally);

    // The result payload is large — a full roster is thousands of rows — and
    // has served its purpose once applied. The SyncRun keeps the outcome.
    // Prisma.DbNull, not undefined: undefined would leave the column untouched.
    await db.bridgeJob.update({
      where: { id: jobId },
      data: { processedAt: new Date(), syncRunId: runId, result: Prisma.DbNull },
    });

    return {
      runId,
      status: tally.status(),
      received: tally.received,
      applied: tally.applied,
      skipped: tally.skipped,
      rejected: tally.rejected,
      details: tally.serialisedDetails(),
    };
  } catch (error) {
    await failSyncRun(runId, error);
    throw error;
  }
}
