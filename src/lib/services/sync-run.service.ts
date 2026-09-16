import { db } from "@/lib/db";
import type { SyncKind, SyncRunStatus } from "@prisma/client";

/**
 * Bookkeeping for the VM sync service.
 *
 * <p>The service runs unattended every 15 minutes on a machine nobody logs
 * into. Without a run log, "synced and nothing changed" and "has not run
 * since Tuesday" are indistinguishable from inside CloudTime — and the second
 * one only surfaces when somebody's badge stops working. A row is written
 * before any work happens, so a crash mid-run leaves a RUNNING row rather
 * than no evidence at all.
 */

/**
 * One row's outcome, accumulated during a run.
 *
 * `code` is a stable machine-readable reason (SKIPPED_OVERRIDE,
 * BARCODE_CONFLICT, …); `ref` identifies the row it happened to, usually an
 * Oracle empId, so a report can be traced back to a person without joining.
 */
export type SyncDetail = { code: string; ref: string; message: string };

/**
 * Per-row detail is capped so one malformed export cannot write a megabyte of
 * JSON into the run log. The counters are always exact; only the narrative is
 * truncated, and the run records that it was.
 */
const MAX_DETAILS = 200;

export class SyncTally {
  received = 0;
  applied = 0;
  skipped = 0;
  rejected = 0;
  readonly details: SyncDetail[] = [];
  private overflow = 0;

  note(code: string, ref: string, message: string): void {
    if (this.details.length < MAX_DETAILS) this.details.push({ code, ref, message });
    else this.overflow++;
  }

  /** Details as stored, with a marker when some were dropped. */
  serialisedDetails(): SyncDetail[] {
    if (!this.overflow) return this.details;
    return [
      ...this.details,
      { code: "TRUNCATED", ref: "-", message: `${this.overflow} further rows not listed` },
    ];
  }

  /**
   * A run that rejected nothing SUCCEEDED; one that applied some and rejected
   * some is PARTIAL, which is the ordinary state of a sync against a source
   * system with imperfect data — it is not an error and should not page anyone.
   */
  status(): SyncRunStatus {
    return this.rejected > 0 ? "PARTIAL" : "SUCCEEDED";
  }
}

export async function startSyncRun(
  tenantId: string,
  kind: SyncKind,
  agent?: string | null,
): Promise<string> {
  const run = await db.syncRun.create({
    data: { tenantId, kind, agent: agent ?? null },
    select: { id: true },
  });
  return run.id;
}

export async function finishSyncRun(runId: string, tally: SyncTally): Promise<void> {
  await db.syncRun.update({
    where: { id: runId },
    data: {
      status: tally.status(),
      finishedAt: new Date(),
      received: tally.received,
      applied: tally.applied,
      skipped: tally.skipped,
      rejected: tally.rejected,
      details: tally.serialisedDetails(),
    },
  });
}

export async function failSyncRun(runId: string, error: unknown): Promise<void> {
  await db.syncRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      error: error instanceof Error ? error.message : String(error),
    },
  }).catch(() => {
    // The run log must never be the reason a request fails. A lost failure
    // row leaves a RUNNING row behind, which reads as a fault anyway.
  });
}
