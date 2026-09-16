import { db } from "@/lib/db";
import { SyncTally } from "@/lib/services/sync-run.service";

/**
 * Applies an Oracle roster batch to CloudTime employees.
 *
 * <p><b>What this deliberately does not do: create people.</b> An Employee
 * needs a site, a department, a rule set and a hire date, and Oracle supplies
 * none of them. The rule set is what computes overtime, so an invented one
 * produces a timecard that looks complete and pays wrong — worse than no
 * timecard, because nothing about it looks broken. Unknown employees are
 * staged as RosterCandidate rows for a human to create properly.
 *
 * <p><b>And it does not flip isActive.</b> Deactivating someone stops them
 * clocking in, which costs them pay and is discovered at the gate; activating
 * someone Oracle has terminated creates a ghost who can still punch. Both are
 * bad enough that a 15-minute unattended job should not do either on its own
 * authority, so a disagreement is reported and left for a person. Flip
 * APPLY_ACTIVE_STATE once the feed has been trusted for a few weeks.
 */

/** See the note above before changing this. */
const APPLY_ACTIVE_STATE = false;

export type RosterRow = {
  /** framewrk.users.empid — the 6-digit employee number, and the join key. */
  empId: string;
  /** framewrk.users.usersid — the surrogate key schedule writes need. */
  usersId?: string | null;
  /** wmsusers.barcode, as Oracle stores it (unpadded). */
  barcode?: string | null;
  name?: string | null;
  departmentName?: string | null;
  siteName?: string | null;
  /** Oracle's view of whether this person is still employed. */
  isActive?: boolean | null;
};

/** Oracle stores barcodes unpadded; the tablets pad them to ten characters. */
function normaliseBarcode(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  // Non-numeric values in this column are junk — GUIDs, usernames, free text.
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

export async function applyRosterBatch(
  tenantId: string,
  rows: RosterRow[],
): Promise<SyncTally> {
  const tally = new SyncTally();
  tally.received = rows.length;

  for (const row of rows) {
    const empId = (row.empId ?? "").trim();
    if (!empId) {
      tally.rejected++;
      tally.note("MISSING_EMPID", "-", "Row has no empId");
      continue;
    }

    const barcode = normaliseBarcode(row.barcode);
    // Oracle's barcode column frequently repeats the empId. That is a null
    // mapping recorded as a value, not a badge, and importing it would let an
    // employee number match as a barcode for somebody else.
    const usableBarcode = barcode && barcode !== empId ? barcode : null;

    const employee = await db.employee.findFirst({
      where: { tenantId, wmsId: empId },
      select: {
        id: true,
        barcode: true,
        barcodeOverride: true,
        isActive: true,
        userId: true,
        user: { select: { name: true } },
      },
    });

    if (!employee) {
      await stageCandidate(tenantId, row, empId, usableBarcode);
      tally.rejected++;
      tally.note("NO_EMPLOYEE", empId, "No CloudTime employee — staged for review");
      continue;
    }

    const changes: Record<string, unknown> = {};

    /* ---- barcode ---- */
    if (usableBarcode) {
      if (employee.barcodeOverride) {
        tally.note("SKIPPED_OVERRIDE", empId, `Barcode set by hand; Oracle says ${usableBarcode}`);
      } else if (employee.barcode === usableBarcode) {
        changes.barcodeSyncedAt = new Date();
      } else {
        // The unique index would throw; a clear rejection beats a 500.
        const taken = await db.employee.findFirst({
          where: { barcode: usableBarcode, id: { not: employee.id } },
          select: { wmsId: true },
        });
        if (taken) {
          tally.rejected++;
          tally.note(
            "BARCODE_CONFLICT",
            empId,
            `Barcode ${usableBarcode} already belongs to employee ${taken.wmsId}`,
          );
          continue;
        }
        changes.barcode = usableBarcode;
        changes.barcodeSyncedAt = new Date();
      }
    }

    /* ---- active state: reported, not applied ---- */
    if (typeof row.isActive === "boolean" && row.isActive !== employee.isActive) {
      if (APPLY_ACTIVE_STATE) {
        changes.isActive = row.isActive;
      } else {
        tally.note(
          row.isActive ? "REACTIVATION_FLAGGED" : "TERMINATION_FLAGGED",
          empId,
          `Oracle says ${row.isActive ? "active" : "terminated"}, CloudTime says ${employee.isActive ? "active" : "inactive"}`,
        );
      }
    }

    /* ---- name ---- */
    const name = (row.name ?? "").trim();
    if (name && name !== employee.user.name) {
      await db.user.update({ where: { id: employee.userId }, data: { name } });
      tally.note("NAME_UPDATED", empId, `${employee.user.name ?? "(blank)"} -> ${name}`);
      changes.__nameChanged = true;
    }

    const nameChanged = Boolean(changes.__nameChanged);
    delete changes.__nameChanged;

    const substantive = Object.keys(changes).filter((k) => k !== "barcodeSyncedAt");

    if (Object.keys(changes).length) {
      await db.employee.update({ where: { id: employee.id }, data: changes });
    }

    if (substantive.length || nameChanged) tally.applied++;
    else tally.skipped++;

    // Somebody who was staged as missing and now exists stops being pending.
    await db.rosterCandidate.updateMany({
      where: { tenantId, oracleEmpId: empId, status: "NEW" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  return tally;
}

/**
 * Records an Oracle employee CloudTime has never had, with a count of how many
 * badge scans have already been refused because of it — so the triage list
 * sorts itself by who is actually being hurt rather than by arrival order.
 */
async function stageCandidate(
  tenantId: string,
  row: RosterRow,
  empId: string,
  barcode: string | null,
): Promise<void> {
  let failedScans = 0;
  if (barcode) {
    failedScans = await db.scanEvent.count({
      where: {
        outcome: "NO_EMPLOYEE",
        badgeCode: { in: [barcode, barcode.padStart(10, "0")] },
      },
    });
  }

  const data = {
    oracleUsersId: row.usersId?.trim() || null,
    barcode,
    name: row.name?.trim() || null,
    departmentName: row.departmentName?.trim() || null,
    siteName: row.siteName?.trim() || null,
    isActiveInOracle: row.isActive ?? true,
    failedScans,
  };

  await db.rosterCandidate.upsert({
    where: { tenantId_oracleEmpId: { tenantId, oracleEmpId: empId } },
    // A candidate a human already triaged as IGNORED stays ignored; the sync
    // must not resurrect it every 15 minutes into the review queue.
    update: data,
    create: { tenantId, oracleEmpId: empId, ...data },
  });
}
