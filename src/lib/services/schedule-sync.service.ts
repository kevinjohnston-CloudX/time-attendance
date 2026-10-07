import crypto from "crypto";
import { db } from "@/lib/db";
import { SyncTally } from "@/lib/services/sync-run.service";

/**
 * Brings Oracle's `dailyworkerschedule` into CloudTime's `schedule_days`.
 *
 * <p><b>One direction only, and not by choice.</b> The bridge reaches a
 * read-only standby of the WMS database, and Oracle refuses any write inside a
 * read-only transaction. Writing back would need the primary, which nobody on
 * this side has rights to. So a schedule edited in CloudTime stays in
 * CloudTime; the two systems can disagree, and the job here is to make that
 * disagreement visible rather than to hide it by overwriting one side.
 *
 * <p>That is what `LOCAL_EDIT` is for. A day edited in CloudTime is marked,
 * and a later pull carrying the same Oracle value we already knew about leaves
 * it alone instead of reverting it. If Oracle's value has *also* moved since,
 * the row goes to CONFLICT and stops syncing — a schedule row gates gate
 * admission, and resolving that wrongly puts somebody at a door they cannot
 * open.
 *
 * <p>The mechanism is a fingerprint: a hash of the Oracle row's scheduling
 * fields as of the last pull. An incoming row whose hash matches what we
 * stored is the same row arriving again and cannot conflict with anything; one
 * whose hash differs is a genuine Oracle-side edit. That is what separates
 * "Oracle changed it too" from "Oracle sent it again".
 */

export type OracleScheduleRow = {
  /** framewrk.users.empid, used to resolve the CloudTime employee. */
  empId: string;
  usersId?: string | null;
  /** Primary key of the dailyworkerschedule row. */
  scheduleId: string;
  /** Calendar date, YYYY-MM-DD, in the site's own zone. */
  workDate: string;
  /** HH:mm, matching how Shift stores its times. */
  startTime?: string | null;
  endTime?: string | null;
  mealMinutes?: number | null;
  isWorkday?: boolean | null;
};

export type Scheduling = {
  isWorkday: boolean;
  startTime: string | null;
  endTime: string | null;
  mealMinutes: number | null;
};

/**
 * A bare calendar date as UTC midnight. Schedules are dates, not instants — a
 * site in another timezone must not shift somebody's shift onto the day before.
 */
function toWorkDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((value ?? "").trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fingerprint(s: Scheduling): string {
  const canonical = [
    s.isWorkday ? "1" : "0",
    s.startTime ?? "",
    s.endTime ?? "",
    s.mealMinutes ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function schedulingOf(row: OracleScheduleRow): Scheduling {
  return {
    isWorkday: row.isWorkday ?? true,
    startTime: row.startTime?.trim() || null,
    endTime: row.endTime?.trim() || null,
    mealMinutes: typeof row.mealMinutes === "number" ? row.mealMinutes : null,
  };
}

function sameScheduling(a: Scheduling, b: Scheduling): boolean {
  return fingerprint(a) === fingerprint(b);
}

function describe(s: Scheduling): string {
  if (!s.isWorkday) return "not scheduled";
  const span = s.startTime && s.endTime ? `${s.startTime}-${s.endTime}` : "no times";
  return s.mealMinutes ? `${span} (${s.mealMinutes}m meal)` : span;
}

/* ------------------------------------------------------------------ */
/* Oracle -> CloudTime                                                 */
/* ------------------------------------------------------------------ */

export async function applyScheduleBatch(
  tenantId: string,
  rows: OracleScheduleRow[],
): Promise<SyncTally> {
  const tally = new SyncTally();
  tally.received = rows.length;

  /* One row at a time, and one bad row must never stop the others. On
     2026-09-28 and again on 09-29 a single collision aborted every pull for a
     day, the next day's schedules never arrived, and the gates refused
     everyone without one. A row that throws is now counted as rejected, with
     the error's last line, and the batch carries on. If every row throws,
     the cause is not the data (the database is unreachable, say), so the
     last error is raised and the run is recorded as FAILED, not PARTIAL. */
  let errors = 0;
  let lastError: unknown = null;
  const applyOne = async (row: OracleScheduleRow) => {
    try {
      await applyScheduleRow(tenantId, row, tally);
    } catch (err) {
      errors++;
      lastError = err;
      tally.rejected++;
      const msg = err instanceof Error ? err.message : String(err);
      const lastLine = msg.trim().split("\n").filter(Boolean).pop() ?? "unknown error";
      tally.note("ROW_ERROR", (row.empId ?? "").trim() || "-", `${row.workDate}: ${lastLine.slice(0, 200)}`);
    }
  };

  /* Most of a pull is Oracle sending the same days again, and badges with no
     CloudTime employee: on 2026-10-07 about half and half of ~3,600 rows every
     five minutes, at three and one round trips each. So everybody and every
     day the batch names are read up front in a few queries, a badge with
     nobody is noted from that, and a day that only needs marking as checked
     is marked together with the rest at the end. Everything else (a new day,
     a change, a conflict, a day named twice in one batch) still goes through
     applyScheduleRow one at a time, in batch order, reading fresh. Notes come
     out in the same order as before, because only the checked days are moved
     and they never write one. If the reading up front fails, the batch runs
     the old way, row by row, so a failure is reported exactly as it was. */
  let known: Known;
  try {
    known = await readKnown(tenantId, rows);
  } catch {
    for (const row of rows) await applyOne(row);
    if (errors > 0 && errors === rows.length) throw lastError;
    return tally;
  }

  const checked: { id: string; row: OracleScheduleRow }[] = [];
  for (const row of rows) {
    const empId = (row.empId ?? "").trim();
    const workDate = toWorkDate(row.workDate ?? "");
    if (!empId || !workDate) {
      await applyOne(row);
      continue;
    }
    const employeeId = known.employees.get(empId);
    if (!employeeId) {
      tally.rejected++;
      tally.note("NO_EMPLOYEE", empId, "No CloudTime employee for this Oracle empId");
      continue;
    }
    const key = dayKey(employeeId, workDate);
    const existing = known.days.get(key);
    if (existing && !known.repeated.has(key) && onlyNeedsCheck(existing, schedulingOf(row))) {
      checked.push({ id: existing.id, row });
      continue;
    }
    await applyOne(row);
  }

  if (checked.length) {
    try {
      const oracleSyncedAt = new Date();
      for (let i = 0; i < checked.length; i += CHUNK) {
        await db.scheduleDay.updateMany({
          where: { id: { in: checked.slice(i, i + CHUNK).map((c) => c.id) } },
          data: { oracleSyncedAt },
        });
      }
      tally.skipped += checked.length;
    } catch {
      // Marking them together failed: each goes the old way and reports its own error.
      for (const c of checked) await applyOne(c.row);
    }
  }

  if (errors > 0 && errors === rows.length) throw lastError;

  return tally;
}

/** How many ids go in one `IN (...)` list. */
const CHUNK = 1_000;

type KnownDay = Scheduling & { id: string; syncState: string; oracleFingerprint: string | null };
type Known = {
  /** Oracle empId -> CloudTime employee id, for this company. */
  employees: Map<string, string>;
  /** Every schedule day this batch names that already exists, by dayKey. */
  days: Map<string, KnownDay>;
  /** Days the batch names more than once: an earlier row can change what a later one finds. */
  repeated: Set<string>;
};

function dayKey(employeeId: string, workDate: Date): string {
  return `${employeeId}|${workDate.toISOString().slice(0, 10)}`;
}

/** Everybody and every existing day the batch names, in a few queries instead of two per row. */
async function readKnown(tenantId: string, rows: OracleScheduleRow[]): Promise<Known> {
  const empIds = [...new Set(rows.map((r) => (r.empId ?? "").trim()).filter(Boolean))];
  const employees = new Map<string, string>();
  for (let i = 0; i < empIds.length; i += CHUNK) {
    const found = await db.employee.findMany({
      where: { tenantId, wmsId: { in: empIds.slice(i, i + CHUNK) } },
      select: { id: true, wmsId: true },
    });
    for (const e of found) if (e.wmsId) employees.set(e.wmsId, e.id);
  }

  const wanted = new Map<string, number>();
  const dates = new Set<string>();
  for (const r of rows) {
    const employeeId = employees.get((r.empId ?? "").trim());
    const workDate = toWorkDate(r.workDate ?? "");
    if (!employeeId || !workDate) continue;
    const key = dayKey(employeeId, workDate);
    wanted.set(key, (wanted.get(key) ?? 0) + 1);
    dates.add(workDate.toISOString().slice(0, 10));
  }
  const repeated = new Set([...wanted].filter(([, n]) => n > 1).map(([k]) => k));

  const days = new Map<string, KnownDay>();
  const ids = [...new Set([...wanted.keys()].map((k) => k.split("|")[0]))];
  const workDates = [...dates].map((d) => new Date(`${d}T00:00:00.000Z`));
  for (let i = 0; i < ids.length && workDates.length; i += CHUNK) {
    const found = await db.scheduleDay.findMany({
      where: { employeeId: { in: ids.slice(i, i + CHUNK) }, workDate: { in: workDates } },
      select: {
        id: true,
        employeeId: true,
        workDate: true,
        syncState: true,
        oracleFingerprint: true,
        isWorkday: true,
        startTime: true,
        endTime: true,
        mealMinutes: true,
      },
    });
    for (const d of found) {
      const key = dayKey(d.employeeId, d.workDate);
      if (wanted.has(key)) days.set(key, d);
    }
  }
  return { employees, days, repeated };
}

/**
 * Whether applyScheduleRow would only mark this day as checked: Oracle sent
 * it again unchanged, over a day CloudTime edited (LOCAL_EDIT) or one it holds
 * as Oracle's (any other state but CONFLICT). The same two tests, word for
 * word, as the two `oracleSyncedAt` only branches there; keep them together.
 */
function onlyNeedsCheck(existing: KnownDay, incoming: Scheduling): boolean {
  if (existing.syncState === "CONFLICT") return false;
  const incomingPrint = fingerprint(incoming);
  if (existing.syncState === "LOCAL_EDIT") return existing.oracleFingerprint === incomingPrint;
  const local: Scheduling = {
    isWorkday: existing.isWorkday,
    startTime: existing.startTime,
    endTime: existing.endTime,
    mealMinutes: existing.mealMinutes,
  };
  return existing.oracleFingerprint === incomingPrint && sameScheduling(incoming, local);
}

/**
 * Takes an Oracle schedule id away from any other CloudTime record that still
 * holds it, so it can be written on the record that owns the empId now.
 *
 * <p>This is the case that broke the pull twice. An employee's Oracle empId
 * (wmsId) was moved from an old CloudTime record to a newer one, by hand or by
 * the roster sync. The old record kept its Oracle schedule days, each carrying
 * the unique oracleScheduleId, so creating the same day on the new record hit
 * the unique constraint. The old record can never receive that day again (the
 * pull finds employees only by wmsId), so its link is stale: only the id is
 * cleared, the old row itself is left as it was.
 */
async function releaseScheduleId(
  tenantId: string,
  scheduleId: string | null,
  employeeId: string,
  empId: string,
  tally: SyncTally,
): Promise<void> {
  if (!scheduleId) return;
  const released = await db.scheduleDay.updateMany({
    where: { tenantId, oracleScheduleId: scheduleId, employeeId: { not: employeeId } },
    data: { oracleScheduleId: null },
  });
  if (released.count > 0) {
    tally.note(
      "SCHEDULE_ID_MOVED",
      empId,
      `Oracle schedule ${scheduleId} was still on another CloudTime record; moved to this employee's current record`,
    );
  }
}

async function applyScheduleRow(
  tenantId: string,
  row: OracleScheduleRow,
  tally: SyncTally,
): Promise<void> {
  const empId = (row.empId ?? "").trim();
  const workDate = toWorkDate(row.workDate ?? "");

  if (!empId || !workDate) {
    tally.rejected++;
    tally.note("BAD_ROW", empId || "-", `Unusable empId or workDate (${row.workDate})`);
    return;
  }

  const employee = await db.employee.findFirst({
    where: { tenantId, wmsId: empId },
    select: { id: true },
  });
  if (!employee) {
    tally.rejected++;
    tally.note("NO_EMPLOYEE", empId, "No CloudTime employee for this Oracle empId");
    return;
  }

  const incoming = schedulingOf(row);
  const incomingPrint = fingerprint(incoming);

  const existing = await db.scheduleDay.findUnique({
    where: { employeeId_workDate: { employeeId: employee.id, workDate } },
  });

  const oracleFields = {
    oracleScheduleId: row.scheduleId?.trim() || null,
    oracleUsersId: row.usersId?.trim() || null,
    oracleFingerprint: incomingPrint,
    oracleSyncedAt: new Date(),
  };

  if (!existing) {
    await releaseScheduleId(tenantId, oracleFields.oracleScheduleId, employee.id, empId, tally);
    await db.scheduleDay.create({
      data: {
        tenantId,
        employeeId: employee.id,
        workDate,
        ...incoming,
        ...oracleFields,
        source: "ORACLE",
        syncState: "SYNCED",
      },
    });
    tally.applied++;
    return;
  }

  const local: Scheduling = {
    isWorkday: existing.isWorkday,
    startTime: existing.startTime,
    endTime: existing.endTime,
    mealMinutes: existing.mealMinutes,
  };

  /* A row a human already flagged stays flagged. Re-applying Oracle here
     would silently discard the very edit the conflict was raised about. */
  if (existing.syncState === "CONFLICT") {
    tally.skipped++;
    tally.note("CONFLICT_PENDING", empId, `${row.workDate} still awaiting resolution`);
    return;
  }

  /* CloudTime holds an edit Oracle has never been told about. */
  if (existing.syncState === "LOCAL_EDIT") {
    if (existing.oracleFingerprint === incomingPrint) {
      // Oracle has not moved since we last looked, so the local edit is the
      // only change and survives untouched. Record that we checked.
      await db.scheduleDay.update({
        where: { id: existing.id },
        data: { oracleSyncedAt: new Date() },
      });
      tally.skipped++;
    } else {
      await db.scheduleDay.update({
        where: { id: existing.id },
        data: {
          syncState: "CONFLICT",
          conflictNote:
            `Oracle changed this day to ${describe(incoming)} after CloudTime had ` +
            `set it to ${describe(local)}. CloudTime's value was kept and nothing ` +
            `was overwritten; Oracle cannot be updated from here.`,
          oracleFingerprint: incomingPrint,
          oracleSyncedAt: new Date(),
        },
      });
      tally.rejected++;
      tally.note("CONFLICT", empId, `${row.workDate}: both sides changed`);
    }
    return;
  }

  /* SYNCED: Oracle is authoritative. */
  if (existing.oracleFingerprint === incomingPrint && sameScheduling(incoming, local)) {
    await db.scheduleDay.update({
      where: { id: existing.id },
      data: { oracleSyncedAt: new Date() },
    });
    tally.skipped++;
  } else {
    if (existing.oracleScheduleId !== oracleFields.oracleScheduleId) {
      await releaseScheduleId(tenantId, oracleFields.oracleScheduleId, employee.id, empId, tally);
    }
    await db.scheduleDay.update({
      where: { id: existing.id },
      data: { ...incoming, ...oracleFields, source: "ORACLE", syncState: "SYNCED" },
    });
    tally.applied++;
  }
}

/* ------------------------------------------------------------------ */
/* CloudTime-side edits                                                */
/* ------------------------------------------------------------------ */

/**
 * Records a schedule edit made inside CloudTime.
 *
 * <p>The row is marked LOCAL_EDIT, which is what stops the next Oracle pull
 * reverting it. Oracle is not told — it cannot be, over a read-only standby —
 * so this deliberately creates a known divergence rather than pretending the
 * two systems agree. Anything that depends on Oracle seeing the change (gate
 * admission, for one) still needs a separate route to WMS.
 */
export async function setScheduleDay(
  tenantId: string,
  employeeId: string,
  workDateIso: string,
  scheduling: Scheduling,
  updatedById?: string,
): Promise<void> {
  const workDate = toWorkDate(workDateIso);
  if (!workDate) throw new Error(`Invalid workDate: ${workDateIso}`);

  await db.scheduleDay.upsert({
    where: { employeeId_workDate: { employeeId, workDate } },
    update: { ...scheduling, source: "CLOUDTIME", syncState: "LOCAL_EDIT", updatedById },
    create: {
      tenantId,
      employeeId,
      workDate,
      ...scheduling,
      source: "CLOUDTIME",
      syncState: "LOCAL_EDIT",
      updatedById,
    },
  });
}

/** Days where CloudTime and Oracle disagree and nobody has decided yet. */
export async function findScheduleConflicts(tenantId: string) {
  return db.scheduleDay.findMany({
    where: { tenantId, syncState: "CONFLICT" },
    orderBy: { workDate: "asc" },
    include: { employee: { select: { wmsId: true, user: { select: { name: true } } } } },
  });
}
