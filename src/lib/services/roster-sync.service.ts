import { db } from "@/lib/db";
import { SyncTally } from "@/lib/services/sync-run.service";

/**
 * Applies an Oracle roster batch to CloudTime employees.
 *
 * <p><b>What this deliberately does not do: create people.</b> An Employee
 * needs a site, a department, a rule set and a hire date, and Oracle supplies
 * none of them. The rule set is what computes overtime, so an invented one
 * produces a timecard that looks complete and pays wrong — worse than no
 * timecard, because nothing about it looks broken. Unknown employees who are
 * actually being turned away at a kiosk are staged as RosterCandidate rows for
 * a human to create properly.
 *
 * <p><b>And it does not flip isActive.</b> Deactivating someone stops them
 * clocking in, which costs them pay and is discovered at the gate; activating
 * someone Oracle has terminated creates a ghost who can still punch. Both are
 * bad enough that a 15-minute unattended job should not do either on its own
 * authority, so a disagreement is reported and left for a person. Flip
 * APPLY_ACTIVE_STATE once the feed has been trusted for a few weeks.
 *
 * <p><b>Why this reads everything up front.</b> `framewrk.users` returns about
 * 18,000 rows and CloudTime has a few hundred employees, so the overwhelming
 * majority of a batch matches nothing. An earlier version issued two or three
 * queries per row, which is ~50,000 round trips for one sync — it would not
 * finish inside a serverless request. Everything needed to decide is loaded in
 * three queries and the per-row work happens in memory; only genuine changes
 * are written.
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

/**
 * Oracle's user table carries sentinel and test rows — `-1`, `0`, `1` all
 * appear — alongside real employee numbers. They match nobody and would only
 * pad the review queue with rows no one can act on.
 */
function isPlausibleEmpId(empId: string): boolean {
  if (!/^\d+$/.test(empId)) return false;
  return Number(empId) > 0 && empId.length >= 4;
}

export async function applyRosterBatch(
  tenantId: string,
  rows: RosterRow[],
): Promise<SyncTally> {
  const tally = new SyncTally();
  tally.received = rows.length;

  /* ---- Everything needed to decide, in three queries ---- */

  const employees = await db.employee.findMany({
    where: { tenantId, wmsId: { not: null } },
    select: {
      id: true,
      wmsId: true,
      barcode: true,
      barcodeOverride: true,
      isActive: true,
      userId: true,
      user: { select: { name: true } },
    },
  });

  const byWmsId = new Map(employees.map((e) => [e.wmsId as string, e]));
  // Who already holds each barcode, so a clash is caught without asking the
  // database per row — the unique index would otherwise throw a 500.
  const barcodeOwner = new Map(
    employees.filter((e) => e.barcode).map((e) => [e.barcode as string, e]),
  );

  // How many scans each unmatched badge has already had refused. This is what
  // sorts the review queue by who is actually being hurt, and — since a badge
  // nobody has ever scanned costs nobody anything — what decides whether a
  // missing employee is worth staging at all.
  const refusedByBadge = new Map<string, number>();
  const refused = await db.scanEvent.groupBy({
    by: ["badgeCode"],
    where: { outcome: "NO_EMPLOYEE" },
    _count: { _all: true },
  });
  for (const row of refused) {
    refusedByBadge.set(row.badgeCode, row._count._all);
  }

  /** A badge as Oracle stores it, or zero-padded the way the tablets send it. */
  const refusedCount = (barcode: string | null, empId: string): number =>
    Math.max(
      refusedByBadge.get(empId) ?? 0,
      barcode ? refusedByBadge.get(barcode) ?? 0 : 0,
      barcode ? refusedByBadge.get(barcode.padStart(10, "0")) ?? 0 : 0,
    );

  /* ---- Decide in memory, write only what changed ---- */

  const resolvedEmpIds: string[] = [];
  let ignoredJunk = 0;
  let unmatchedUnseen = 0;

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

    const employee = byWmsId.get(empId);

    if (!employee) {
      if (!isPlausibleEmpId(empId)) {
        ignoredJunk++;
        continue;
      }

      const failedScans = refusedCount(usableBarcode, empId);
      if (failedScans === 0) {
        // Exists in Oracle, unknown here, and has never tried to scan. Almost
        // all of the ~18,000 rows land here: office staff, historical records,
        // other sites. Staging them would bury the handful of people who are
        // standing at a kiosk being turned away.
        unmatchedUnseen++;
        continue;
      }

      await stageCandidate(tenantId, row, empId, usableBarcode, failedScans);
      tally.rejected++;
      tally.note(
        "NO_EMPLOYEE",
        empId,
        `No CloudTime employee — ${failedScans} scan(s) already refused, staged for review`,
      );
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
        const taken = barcodeOwner.get(usableBarcode);
        if (taken && taken.id !== employee.id) {
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
        // Keep the in-memory view honest for the rest of this batch.
        if (employee.barcode) barcodeOwner.delete(employee.barcode);
        barcodeOwner.set(usableBarcode, employee);
        employee.barcode = usableBarcode;
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
    let nameChanged = false;
    if (name && name !== employee.user.name) {
      await db.user.update({ where: { id: employee.userId }, data: { name } });
      tally.note("NAME_UPDATED", empId, `${employee.user.name ?? "(blank)"} -> ${name}`);
      nameChanged = true;
    }

    const substantive = Object.keys(changes).filter((k) => k !== "barcodeSyncedAt");

    if (Object.keys(changes).length) {
      await db.employee.update({ where: { id: employee.id }, data: changes });
    }

    if (substantive.length || nameChanged) tally.applied++;
    else tally.skipped++;

    resolvedEmpIds.push(empId);
  }

  // Anyone who was staged as missing and now exists stops being pending —
  // one statement for the whole batch rather than one per row.
  if (resolvedEmpIds.length) {
    await db.rosterCandidate.updateMany({
      where: { tenantId, oracleEmpId: { in: resolvedEmpIds }, status: "NEW" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  // Counted, not listed: these are the normal bulk of an Oracle roster and
  // saying so once is information, while 17,000 detail lines would not be.
  tally.skipped += ignoredJunk + unmatchedUnseen;
  if (unmatchedUnseen) {
    tally.note(
      "UNMATCHED_NOT_STAGED",
      "-",
      `${unmatchedUnseen} Oracle employees unknown to CloudTime with no refused scans — not staged`,
    );
  }
  if (ignoredJunk) {
    tally.note("JUNK_EMPID", "-", `${ignoredJunk} rows with sentinel or malformed empIds ignored`);
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
  failedScans: number,
): Promise<void> {
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
