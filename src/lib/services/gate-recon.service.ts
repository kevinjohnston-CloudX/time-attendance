import { db } from "@/lib/db";
import { findEmployeeIdentityByBadge } from "@/lib/utils/badge-lookup";
import { snapToLocalTime } from "@/lib/utils/date";
import type { OracleGateScanRow } from "./gate-state-sync.service";
import { recordScanEvent } from "./scan-event.service";
import { SyncTally } from "./sync-run.service";

/**
 * Fills in gate crossings that happened at a reader CloudTime is not connected
 * to, from Oracle's copy of the gate log.
 *
 * <p><b>Why this exists.</b> Gate direction is inferred by alternating from the
 * previous crossing, which is only right when every crossing was seen. On
 * 2026-09-22 at NJ299 a legacy-only reader (Oracle location 49376) took 61 of
 * the morning's first arrivals; CloudTime's first sight of those people was
 * their evening exit, which alternation called IN — 47 wrong exits, three
 * quarters of the day's errors. Until every reader people cross is a CloudTime
 * tablet, this is the safety net.
 *
 * <p><b>What it takes from Oracle: timestamps only. Never direction.</b> Oracle
 * decides IN/OUT by the same alternation and nothing ever resets it, so after
 * CloudTime's nightly auto-close the two are out of phase and Oracle calls a
 * morning arrival an OUT. Worse, when Oracle is out of phase it writes that
 * arrival into {@code outTime} on the previous still-open row rather than
 * opening a new one — so BOTH columns are read as bare instants, and reading
 * only {@code scanTime} would miss exactly the people the divergence affected.
 * CloudTime resolves direction itself, anchored by its own auto-close.
 *
 * <p><b>Why only today.</b> Inserting a crossing from before last night's
 * AUTO_CLOSE would re-resolve the chain across the anchor. Anything earlier
 * than local midnight is left alone.
 *
 * <p><b>Why this is temporary.</b> Oracle is being retired. This job, the
 * {@code ORACLE_RECON} slot and the bridge handler behind it are deleted at
 * cutover — which is why it records under the existing GATE_STATE sync kind
 * rather than earning a Prisma enum value and a migration of its own.
 */

/** Provenance of a row this job inserts. Never "LIVE": no tablet saw these. */
export const ORACLE_RECON_SLOT = "ORACLE_RECON";

/** A live gate row this close to an Oracle instant is the same crossing. */
const SAME_CROSSING_MS = 3 * 60_000;

export async function applyGateReconBatch(
  tenantId: string,
  rows: OracleGateScanRow[],
): Promise<SyncTally> {
  const tally = new SyncTally();
  tally.received = rows.length;
  const now = new Date();

  for (const row of rows) {
    const badgeCode = (row.badgeId ?? "").trim();
    if (!badgeCode) {
      tally.rejected++;
      tally.note("BAD_ROW", "-", "Row has no badgeId");
      continue;
    }

    const employee = await findEmployeeIdentityByBadge(badgeCode);
    if (!employee) {
      // Already reported by the roster sync as a RosterCandidate; that is
      // where the gap belongs. Nothing to alternate within here.
      tally.rejected++;
      tally.note("NO_EMPLOYEE", badgeCode, "No CloudTime employee for this badge");
      continue;
    }
    if (employee.tenantId && employee.tenantId !== tenantId) {
      tally.skipped++;
      continue;
    }

    const timezone = employee.site?.timezone ?? "America/New_York";
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
    const todayStart = snapToLocalTime("00:00", localDate, timezone);

    // Both columns, deduplicated: a fresh Oracle row has outTime == scanTime.
    const instants = [row.scanTime, row.outTime]
      .map((v) => (v ? new Date(v) : null))
      .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()))
      .filter((d, i, arr) => arr.findIndex((x) => x.getTime() === d.getTime()) === i)
      .filter((d) => d >= todayStart && d <= now);

    for (const scanTime of instants) {
      const near = await db.scanEvent.findFirst({
        where: {
          employeeId: employee.id,
          stream: "SECURITY",
          scanTime: {
            gte: new Date(scanTime.getTime() - SAME_CROSSING_MS),
            lte: new Date(scanTime.getTime() + SAME_CROSSING_MS),
          },
        },
        select: { id: true },
      });
      if (near) {
        tally.skipped++;
        continue;
      }

      // No knownDirection, deliberately. recordScanEvent alternates, and
      // because this is a guessed row inserted into the past it re-resolves
      // everything after it — the whole point of filling the gap.
      const recorded = await recordScanEvent({
        badgeCode,
        stream: "SECURITY",
        scanTime,
        sourceSlot: ORACLE_RECON_SLOT,
        sourceRef: row.scanId ?? null,
        site: row.location === null || row.location === undefined ? null : String(row.location),
        outcome: "NOT_APPLICABLE",
        note: `reconciled from Oracle timestationscanlog ${row.scanId ?? "?"}: a crossing no CloudTime reader saw; timestamp only, direction resolved here`,
      });

      if (recorded.duplicate) {
        tally.skipped++;
      } else {
        tally.applied++;
        tally.note("RECON", badgeCode, `inserted ${scanTime.toISOString()} as ${recorded.direction}`);
      }
    }
  }

  return tally;
}
