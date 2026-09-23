import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { computeRoundedTime } from "@/lib/utils/date";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";

/**
 * Time clock scans refused because nobody held the badge yet, and turning
 * the ones payroll confirms into punches.
 *
 * <p>Somebody who starts before HR has created their record scans in and out
 * all the same. Every one of those scans is stored (recordScanEvent) with no
 * person and outcome NO_EMPLOYEE, and none of it reaches a timecard. Once the
 * record exists, the badge on it identifies those scans again, and this is
 * how payroll puts them back.
 *
 * <p><b>Why payroll decides the type.</b> The live pipeline reads a punch's
 * type off the person's state at the moment of the scan. Hours later, with
 * other punches around it, that state is not knowable, so every scan is
 * offered with a suggestion and payroll confirms Clock in, Clock out or not
 * at all. The punches are written exactly as payroll's own single punch entry
 * writes them (timecard-entry.actions.ts): MANUAL, approved by whoever
 * confirmed them, with a reason, audited, and the hours rebuilt.
 *
 * <p><b>Which pay period.</b> The scan's own, never today's. A period that is
 * locked, or a timesheet that is locked or payroll approved, refuses the
 * whole batch, the same rule the rest of the timecard follows.
 *
 * <p><b>Once only.</b> The scan row is claimed inside the same transaction as
 * the punch, and only while it still has no person, so two people recovering
 * at once cannot make the same scan into two punches.
 */

/** The badge matching the time clock uses (badge-lookup.ts), from the person's side. */
function badgeMatchSql(barcodes: string[], wmsId: string | null): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (barcodes.length) {
    parts.push(Prisma.sql`s."badgeCode" = ANY(${barcodes}::text[])`);
    parts.push(Prisma.sql`ltrim(s."badgeCode", '0') = ANY(${barcodes}::text[])`);
  }
  if (wmsId) parts.push(Prisma.sql`btrim(s."badgeCode") = ${wmsId}`);
  return parts.length ? Prisma.join(parts, " OR ") : Prisma.sql`false`;
}

export interface RefusedScan {
  id: string;
  at: string;
  reader: string | null;
  badgeCode: string;
  /** Within a few minutes of the scan before it: almost always the same tap again. */
  repeat: boolean;
  /** What the day's order suggests. Payroll confirms or changes it. */
  suggested: "CLOCK_IN" | "CLOCK_OUT" | null;
}

/** A second scan this soon after the one before is a repeated tap, not a new punch. */
const REPEAT_MS = 3 * 60_000;

async function loadEmployee(tenantId: string, employeeId: string) {
  return db.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: {
      id: true,
      barcode: true,
      wmsId: true,
      badges: { select: { barcode: true } },
      ruleSet: true,
      ruleSetId: true,
      shift: { select: { startTime: true, endTime: true, workDays: true } },
      site: { select: { timezone: true } },
    },
  });
}

type Emp = NonNullable<Awaited<ReturnType<typeof loadEmployee>>>;

/**
 * The refused scans that belong to this person inside [start, end), oldest
 * first. Unmatched rows usually carry no tenant, so they are taken when the
 * tenant is this one or empty, never at a reader another tenant's site owns.
 */
async function refusedRows(tenantId: string, emp: Emp, start: Date, end: Date, ids?: string[]) {
  const barcodes = [emp.barcode, ...emp.badges.map((b) => b.barcode)].filter((b): b is string => !!b?.trim());
  if (!barcodes.length && !emp.wmsId) return [];
  const others = await db.site.findMany({
    where: { tenantId: { not: tenantId }, wmsWarehouseId: { not: null } },
    select: { wmsWarehouseId: true },
  });
  const foreign = others.map((s) => String(s.wmsWarehouseId));

  // The raw query only finds ids. Times are compared as UTC explicitly,
  // because the column has no zone and a session's own zone would shift it,
  // and the rows are read back through Prisma, which reads them as UTC.
  const found = await db.$queryRaw<{ id: string }[]>`
    SELECT s.id
    FROM scan_events s
    WHERE s."employeeId" IS NULL
      AND s.stream = 'TIME_CLOCK'
      AND s.outcome = 'NO_EMPLOYEE'
      AND (s."tenantId" = ${tenantId} OR s."tenantId" IS NULL)
      AND (s.site IS NULL OR NOT (s.site = ANY(${foreign}::text[])))
      AND s."scanTime" >= (${start}::timestamptz AT TIME ZONE 'UTC')
      AND s."scanTime" < (${end}::timestamptz AT TIME ZONE 'UTC')
      AND (${badgeMatchSql(barcodes, emp.wmsId?.trim() || null)})
      ${ids ? Prisma.sql`AND s.id = ANY(${ids}::text[])` : Prisma.empty}
    LIMIT 500
  `;
  if (!found.length) return [];
  return db.scanEvent.findMany({
    where: { id: { in: found.map((f) => f.id) } },
    orderBy: [{ scanTime: "asc" }, { id: "asc" }],
    select: { id: true, scanTime: true, deviceName: true, badgeCode: true },
  });
}

function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
}

export async function getRefusedScans(
  tenantId: string,
  employeeId: string,
  payPeriodId: string,
): Promise<{ scans: RefusedScan[]; timezone: string } | null> {
  const [emp, period] = await Promise.all([
    loadEmployee(tenantId, employeeId),
    db.payPeriod.findFirst({ where: { id: payPeriodId, tenantId }, select: { startDate: true, endDate: true } }),
  ]);
  if (!emp || !period) return null;
  const tz = emp.site?.timezone || "America/New_York";

  const rows = await refusedRows(tenantId, emp, period.startDate, period.endDate);

  // Suggestions, per local day: repeated taps are left out, and the rest
  // alternate from Clock in, which is how a day without a meal reads.
  const out: RefusedScan[] = [];
  let lastKept = null as { day: string; at: number } | null;
  let nth = 0;
  for (const r of rows) {
    const day = localDay(r.scanTime, tz);
    if (lastKept?.day !== day) nth = 0;
    const repeat = !!lastKept && lastKept.day === day && r.scanTime.getTime() - lastKept.at < REPEAT_MS;
    if (!repeat) {
      lastKept = { day, at: r.scanTime.getTime() };
      nth++;
    }
    out.push({
      id: r.id,
      at: r.scanTime.toISOString(),
      reader: r.deviceName,
      badgeCode: r.badgeCode,
      repeat,
      suggested: repeat ? null : nth % 2 === 1 ? "CLOCK_IN" : "CLOCK_OUT",
    });
  }
  return { scans: out, timezone: tz };
}

export class RecoverError extends Error {}

export async function recoverRefusedScans(
  tenantId: string,
  actorId: string | null,
  input: { employeeId: string; payPeriodId: string; items: { scanId: string; punchType: "CLOCK_IN" | "CLOCK_OUT" }[] },
): Promise<{ added: number; timesheetId: string }> {
  const [emp, period] = await Promise.all([
    loadEmployee(tenantId, input.employeeId),
    db.payPeriod.findFirst({
      where: { id: input.payPeriodId, tenantId },
      select: { id: true, startDate: true, endDate: true, status: true },
    }),
  ]);
  if (!emp || !period) throw new RecoverError("NOT_FOUND");
  if (period.status === "LOCKED") throw new RecoverError("This pay period is locked. Reopen it to add punches.");

  const ids = [...new Set(input.items.map((i) => i.scanId))];
  if (ids.length !== input.items.length) throw new RecoverError("The same scan was picked twice.");

  // Re-read every scan with the full scope, so an id from the browser is
  // only ever one of this person's refused scans in this period.
  const rows = await refusedRows(tenantId, emp, period.startDate, period.endDate, ids);
  if (rows.length !== ids.length) {
    throw new RecoverError("Some of these scans have already been added or are no longer available. Reload and try again.");
  }
  const byId = new Map(rows.map((r) => [r.id, r]));

  const ts = await findOrCreateTimesheet(emp.id, period.id);
  if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
    throw new RecoverError("This timecard is locked or approved for pay. Reopen it to add punches.");
  }

  const tz = emp.site?.timezone || "UTC";
  const planned = input.items
    .map((i) => {
      const r = byId.get(i.scanId)!;
      return {
        scan: r,
        punchType: i.punchType,
        roundedTime: computeRoundedTime(r.scanTime, i.punchType, emp.ruleSet, emp.shift, tz),
      };
    })
    .sort((a, b) => a.scan.scanTime.getTime() - b.scan.scanTime.getTime());

  // The same guard as payroll's single punch entry: two punches cannot land
  // on the same rounded minute, whether already there or both in this batch.
  const taken = await db.punch.findMany({
    where: { timesheetId: ts.id, isApproved: true, correctedById: null, roundedTime: { in: planned.map((p) => p.roundedTime) } },
    select: { roundedTime: true },
  });
  const seen = new Set(taken.map((t) => t.roundedTime.getTime()));
  for (const p of planned) {
    const k = p.roundedTime.getTime();
    if (seen.has(k)) {
      const when = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(p.roundedTime);
      throw new RecoverError(`A punch already rounds to ${when}. Leave that scan out, or change the punch already there first.`);
    }
    seen.add(k);
  }

  const written: { punchType: string; at: string; reason: string; scanId: string; badgeCode: string }[] = [];
  await db.$transaction(async (tx) => {
    for (const p of planned) {
      const reason = `Recovered from a refused scan${p.scan.deviceName ? ` at ${p.scan.deviceName}` : ""}`;
      const punch = await tx.punch.create({
        data: {
          employeeId: emp.id,
          timesheetId: ts.id,
          punchType: p.punchType,
          punchTime: p.scan.scanTime,
          roundedTime: p.roundedTime,
          source: "MANUAL",
          stateBefore: "OUT",
          stateAfter: p.punchType === "CLOCK_IN" ? "WORK" : "OUT",
          isApproved: true,
          approvedById: actorId,
          approvedAt: new Date(),
          note: reason,
          payCodeId: p.punchType === "CLOCK_IN" ? (emp.ruleSet.defaultPayCodeId ?? null) : null,
        },
      });
      // Claimed only while it still belongs to nobody. A second recovery
      // racing this one finds nothing to claim and the whole batch rolls back.
      const claimed = await tx.scanEvent.updateMany({
        where: { id: p.scan.id, employeeId: null, outcome: "NO_EMPLOYEE", punchId: null },
        data: {
          employeeId: emp.id,
          tenantId,
          punchId: punch.id,
          outcome: "PUNCH_RECORDED",
          timecardPunchType: p.punchType,
          timecardStateAfter: p.punchType === "CLOCK_IN" ? "WORK" : "OUT",
          note: "Recovered by payroll after the employee was added",
        },
      });
      if (claimed.count !== 1) {
        throw new RecoverError("Some of these scans have already been added. Reload and try again.");
      }
      written.push({ punchType: p.punchType, at: p.scan.scanTime.toISOString(), reason, scanId: p.scan.id, badgeCode: p.scan.badgeCode });
    }
  });

  // After the commit, so a batch that rolled back leaves no trail claiming
  // punches that were never written.
  for (const w of written) {
    await writeAuditLog({
      tenantId,
      actorId,
      action: "MANUAL_PUNCH_ADDED",
      entityType: "TIMESHEET",
      entityId: ts.id,
      changes: {
        after: {
          punchType: w.punchType,
          punchTime: w.at,
          reason: w.reason,
          source: "MANUAL",
          recoveredFromScanId: w.scanId,
          badgeCode: w.badgeCode,
        },
      },
    });
  }

  await rebuildSegments(ts.id, emp.ruleSet);
  return { added: planned.length, timesheetId: ts.id };
}
