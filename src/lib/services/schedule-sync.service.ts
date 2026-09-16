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

  for (const row of rows) {
    const empId = (row.empId ?? "").trim();
    const workDate = toWorkDate(row.workDate ?? "");

    if (!empId || !workDate) {
      tally.rejected++;
      tally.note("BAD_ROW", empId || "-", `Unusable empId or workDate (${row.workDate})`);
      continue;
    }

    const employee = await db.employee.findFirst({
      where: { tenantId, wmsId: empId },
      select: { id: true },
    });
    if (!employee) {
      tally.rejected++;
      tally.note("NO_EMPLOYEE", empId, "No CloudTime employee for this Oracle empId");
      continue;
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
      continue;
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
      continue;
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
      continue;
    }

    /* SYNCED: Oracle is authoritative. */
    if (existing.oracleFingerprint === incomingPrint && sameScheduling(incoming, local)) {
      await db.scheduleDay.update({
        where: { id: existing.id },
        data: { oracleSyncedAt: new Date() },
      });
      tally.skipped++;
    } else {
      await db.scheduleDay.update({
        where: { id: existing.id },
        data: { ...incoming, ...oracleFields, source: "ORACLE", syncState: "SYNCED" },
      });
      tally.applied++;
    }
  }

  return tally;
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
