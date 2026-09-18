import { db } from "@/lib/db";
import { findEmployeeIdentityByBadge } from "@/lib/utils/badge-lookup";
import { SyncTally } from "@/lib/services/sync-run.service";
import type { ScanDirection } from "@prisma/client";

/**
 * Seeds each badge's security-gate IN/OUT baseline from Oracle.
 *
 * <p><b>The problem this solves.</b> `scan_events` resolves a gate scan's
 * direction by alternating from that badge's previous scan in the same stream.
 * With no previous scan the answer is IN, because the first scan of a day is
 * an arrival. That is right in steady state and wrong exactly once per badge:
 * at go-live, when the table is empty, somebody walking OUT of the building is
 * recorded as walking in, and every scan after it inherits the inversion until
 * the next odd-numbered scan puts it back. It has been showing up as a false
 * `legacyMismatch` on the first scan per badge.
 *
 * <p>Oracle has always known the answer. `timestationscanlog` holds a real
 * IN/OUT per badge, and the legacy API treats the highest `scanid` as current
 * (EmployeeRepository.GetTimeStationScanLog). Importing that one row per badge
 * gives the alternation something true to start from.
 *
 * <p><b>The safety rule, and it is the whole design: a badge that already has
 * ANY security scan in CloudTime is left completely alone.</b> A seed row is
 * historical — its scanTime is in the past — and `recordScanEvent` repairs the
 * alternation of everything after a late insert. So seeding a badge that is
 * already live would not merely add a row; it would walk forward through that
 * employee's real scans and flip them. Since the gate display reads from this
 * table, that is somebody at a door being shown the wrong state. Seeding only
 * the untouched badges cannot do that, and the only thing lost is the ability
 * to re-seed — which is not something that should be possible anyway.
 */

export type OracleGateScanRow = {
  /** `timestationscanlog.badgeid` — already translated to an empId by Oracle. */
  badgeId: string;
  scanId?: string | null;
  /** "IN" or "OUT" as the legacy gate writes them. */
  scanType?: string | null;
  /** ISO instant. */
  scanTime: string;
  location?: number | null;
  outTime?: string | null;
};

function toDirection(scanType: string | null | undefined): ScanDirection | null {
  const value = (scanType ?? "").trim().toUpperCase();
  if (value === "IN") return "IN";
  if (value === "OUT") return "OUT";
  // Anything else is not a direction. A guess here would be indistinguishable
  // from the skew this whole job exists to remove.
  return null;
}

export async function applyGateStateBatch(
  tenantId: string,
  rows: OracleGateScanRow[],
): Promise<SyncTally> {
  const tally = new SyncTally();
  tally.received = rows.length;

  for (const row of rows) {
    const badgeCode = (row.badgeId ?? "").trim();
    if (!badgeCode) {
      tally.rejected++;
      tally.note("BAD_ROW", "-", "Row has no badgeId");
      continue;
    }

    const direction = toDirection(row.scanType);
    if (!direction) {
      tally.rejected++;
      tally.note("NO_DIRECTION", badgeCode, `Unusable scanType "${row.scanType ?? ""}"`);
      continue;
    }

    // A `timestationscanlog` row is a crossing PAIR, not one event. The legacy
    // gate inserts it on the way in with `scantime` and `scantype = IN`, then
    // on the way out UPDATES the same row: `scantype` becomes OUT and `outtime`
    // is stamped (EmployeesController.TimeStationScanLog). So for an OUT row
    // the moment being described is `outTime`; `scanTime` is when that person
    // arrived, hours earlier. Seeding the arrival time against an OUT
    // direction would place the baseline in the wrong part of the day.
    const instant = direction === "OUT" && row.outTime ? row.outTime : row.scanTime;
    const scanTime = new Date(instant ?? "");
    if (Number.isNaN(scanTime.getTime())) {
      tally.rejected++;
      tally.note("BAD_ROW", badgeCode, `Unusable scan time (${instant})`);
      continue;
    }

    // Alternation is per employee, so a baseline for a badge nobody matches
    // would never be read. Those badges are already reported by the roster
    // sync as RosterCandidates, which is where that gap belongs.
    const employee = await findEmployeeIdentityByBadge(badgeCode);
    if (!employee) {
      tally.rejected++;
      tally.note("NO_EMPLOYEE", badgeCode, "No CloudTime employee for this badge");
      continue;
    }

    // The rule above. Any existing security scan means this stream is live.
    const existing = await db.scanEvent.findFirst({
      where: { employeeId: employee.id, stream: "SECURITY" },
      select: { id: true },
    });
    if (existing) {
      tally.skipped++;
      continue;
    }

    try {
      await db.scanEvent.create({
        data: {
          tenantId: employee.tenantId,
          employeeId: employee.id,
          badgeCode,
          stream: "SECURITY",
          direction,
          // A baseline, not an observation: this is the state the legacy system
          // was left in, planted so the first real scan alternates off something
          // rather than defaulting to IN. Marked so a consumer can tell it from
          // a scan that actually happened at a reader.
          directionSource: "SEEDED",
          scanTime,
          site: row.location == null ? null : String(row.location),
          sourceSlot: "GATE_SEED",
          sourceRef: row.scanId == null ? null : String(row.scanId),
          // A gate crossing never enters the timecard pipeline, and this one
          // happened before CloudTime existed. Leaving it PENDING would have
          // the discrepancy sweep chase a punch that was never meant to exist.
          outcome: "NOT_APPLICABLE",
          // This row IS the legacy value rather than a reading of it, so it
          // cannot disagree with itself — legacyMismatch stays false.
          legacyScanType: direction,
          note: `seeded from Oracle timestationscanlog${row.scanId ? ` scanid ${row.scanId}` : ""}`,
        },
      });
      tally.applied++;
    } catch (error) {
      // Unique (badgeCode, stream, scanTime): two runs racing, or this exact
      // instant already stored. Either way the baseline exists.
      if (typeof error === "object" && error && (error as { code?: string }).code === "P2002") {
        tally.skipped++;
        continue;
      }
      throw error;
    }
  }

  return tally;
}
