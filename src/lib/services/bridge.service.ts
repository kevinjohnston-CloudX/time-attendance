import { db } from "@/lib/db";
import { Prisma, type SyncKind } from "@prisma/client";
import { applyRosterBatch, type RosterRow } from "@/lib/services/roster-sync.service";
import {
  applyScheduleBatch,
  type OracleScheduleRow,
} from "@/lib/services/schedule-sync.service";
import {
  applyGateStateBatch,
  type OracleGateScanRow,
} from "@/lib/services/gate-state-sync.service";
import { applyGateReconBatch } from "@/lib/services/gate-recon.service";
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
export const GATE_STATE_PULL_KIND = "gatestate.pull";
/**
 * Today's gate crossings from Oracle, to fill in readers CloudTime cannot see.
 * Temporary — see gate-recon.service. Deleted at Oracle cutover.
 */
export const GATE_SCAN_RECON_KIND = "gatescan.recon";
export const BRIDGE_JOB_KINDS = [
  ROSTER_SYNC_KIND,
  SCHEDULE_PULL_KIND,
  GATE_STATE_PULL_KIND,
  GATE_SCAN_RECON_KIND,
] as const;

/**
 * How far back the gate-state seed looks for a badge's last scan.
 *
 * <p>Long enough to cover someone returning from a week off, short enough that
 * the baseline is a plausible description of where they are now. A badge whose
 * last gate scan is older than this is left unseeded and resolves IN on its
 * next scan, which is the right answer for someone who has not been on site.
 */
export const GATE_STATE_DAYS = 14;

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

/**
 * How far either side of today a "day" scope reaches, in days.
 *
 * <p>One, not zero, and that is the whole reason the narrow scope is three days
 * rather than one. Eligibility asks for the workday in the *site's* own zone,
 * and the sites run from Europe/Amsterdam (UTC+2) to America/Los_Angeles
 * (UTC-7). So at 23:00 UTC it is already tomorrow in Amsterdam, and at 02:00
 * UTC it is still yesterday in Los Angeles — a window pinned to the UTC date
 * alone would leave one end of the estate with no row for its own current day,
 * which reads at a gate as "not scheduled".
 */
const SCHEDULE_DAY_SCOPE_PAD = 1;

/**
 * The date window a schedule pull should ask Oracle for.
 *
 * <p><b>"day"</b> is today and a day either side: what a gate needs to decide
 * whether somebody may come in right now. <b>"full"</b> is the whole -7/+28 span.
 *
 * <p>The split exists because only one thing reads this table to make a
 * decision — {@code /api/timeclock/eligibility}, and it reads exactly one row,
 * for today. Pulling 35 days to serve that fetches 14,450 rows a pass where
 * ~1,200 would do, and every row for an employee CloudTime does not have counts
 * as a rejection, which is why a healthy sync still reports PARTIAL. The full
 * sweep still runs, just not on every pass: those extra days are for history
 * and for anything that later reads ahead, neither of which is urgent the way
 * a person standing at a door is.
 */
export function scheduleWindow(scope: "day" | "full" = "full"): {
  dateFrom: string;
  dateTo: string;
} {
  const back = scope === "day" ? SCHEDULE_DAY_SCOPE_PAD : SCHEDULE_DAYS_BACK;
  // The bridge bounds this exclusively (`scheduledate < :dateTo`), so the
  // forward pad needs one more day than it reaches to include tomorrow itself.
  const forward = scope === "day" ? SCHEDULE_DAY_SCOPE_PAD + 1 : SCHEDULE_DAYS_FORWARD;

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - back);
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + forward);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

/**
 * Whether the gate-state seed is worth queueing for this tenant right now.
 *
 * <p>Unlike the roster and the schedule, this one is not a feed. It only ever
 * writes for badges that have no security history at all, so once a badge is
 * live the job does nothing for it forever. Running it on the 15-minute
 * cadence would mean a full `timestationscanlog` scan four times an hour to
 * apply nothing. Once a day picks up newly created employees and costs
 * essentially nothing the rest of the time.
 */
export async function gateStateSeedDue(tenantId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const recent = await db.syncRun.findFirst({
    where: { tenantId, kind: "GATE_STATE", startedAt: { gte: since } },
    select: { id: true },
  });
  return !recent;
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

  if (kind === GATE_STATE_PULL_KIND) {
    const rows = extractRows<OracleGateScanRow>(result, "scans");
    return runAndRecord(jobId, tenantId, "GATE_STATE", () =>
      applyGateStateBatch(tenantId, rows),
    );
  }

  if (kind === GATE_SCAN_RECON_KIND) {
    const rows = extractRows<OracleGateScanRow>(result, "scans");
    // Recorded as GATE_STATE: SyncKind is a Prisma enum, and a job that is
    // deleted at Oracle cutover does not earn a migration. The run's details
    // carry a RECON code, so the two stay distinguishable in the sync log.
    return runAndRecord(jobId, tenantId, "GATE_STATE", () =>
      applyGateReconBatch(tenantId, rows),
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
  syncKind: SyncKind,
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
