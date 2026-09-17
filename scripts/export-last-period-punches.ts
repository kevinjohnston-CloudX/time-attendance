/**
 * Export all punches from the last pay period to CSV.
 * Columns: WMS ID, Name, Date, Pay Code, Punch In, Punch Out, REG hrs, OT hrs, DT hrs
 * OT/DT pulled from WorkSegment payBucket which is already calculated per rule set.
 *
 * Usage: npx tsx scripts/export-last-period-punches.ts [tenantId]
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Scripts use DIRECT_URL if set, otherwise fall back to DATABASE_URL with
// port swapped from 6543 (transaction pooler) to 5432 (session pooler).
const rawUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
const connStr = rawUrl.replace(/:6543\//, ":5432/");
if (!connStr) { console.error("No DATABASE_URL found in .env.local"); process.exit(1); }

const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

function fmt(dt: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }).format(dt);
}

function localDateKey(dt: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).formatToParts(dt);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function fmtDateLabel(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${m}/${d}/${y}`;
}

function minsToHrs(mins: number) {
  return (mins / 60).toFixed(2);
}

function pcLabel(pc: { expressCode?: string | null; label?: string } | null | undefined) {
  if (!pc) return "";
  return pc.expressCode || pc.label || "";
}

function csvEscape(val: unknown) {
  const s = String(val ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

async function main() {
  const tenantArg = process.argv[2] ?? null;

  // Optional args: [tenantId] [endDate yyyy-MM-dd]
  // endDate selects which pay cycle to export (the date the period ends, local calendar date).
  // If not provided, picks the most recently ended sub-period.
  const targetEndArg = process.argv[3] ?? null;

  // Find all sub-periods ending around the target date (±2 days for UTC offset).
  // Among those, pick the LONGEST period (biweekly > weekly) so we get the full cycle.
  const endDateFilter = targetEndArg
    ? { gte: new Date(new Date(targetEndArg).getTime() - 86400_000), lt: new Date(new Date(targetEndArg).getTime() + 2 * 86400_000) }
    : { lt: new Date() };

  const candidatePeriods = await db.payPeriod.findMany({
    where: {
      ...(tenantArg ? { tenantId: tenantArg } : {}),
      ruleSetId: { not: null },
      endDate: endDateFilter,
    },
    orderBy: { endDate: "desc" },
    select: { id: true, startDate: true, endDate: true, tenantId: true },
    take: 50,
  });

  if (!candidatePeriods.length) {
    console.error("No completed pay period found.");
    process.exit(1);
  }

  // Group by endDate, pick the group with the oldest startDate (longest period)
  const byEnd = new Map<string, typeof candidatePeriods>();
  for (const p of candidatePeriods) {
    const k = p.endDate.toISOString();
    if (!byEnd.has(k)) byEnd.set(k, []);
    byEnd.get(k)!.push(p);
  }
  // Sort end-date groups newest first, pick first group
  const latestEndGroup = Array.from(byEnd.entries()).sort(([a], [b]) => b.localeCompare(a))[0][1];
  // Within that group, pick the oldest startDate to anchor the full period
  const anchor = latestEndGroup.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

  // Find all sub-periods that share the same start AND end date (one per rule set)
  const matchingPeriods = await db.payPeriod.findMany({
    where: {
      tenantId: anchor.tenantId,
      ruleSetId: { not: null },
      startDate: anchor.startDate,
      endDate:   anchor.endDate,
    },
    select: { id: true, startDate: true, endDate: true },
  });
  const periodIds = matchingPeriods.length ? matchingPeriods.map((p) => p.id) : [anchor.id];
  const startDate = anchor.startDate;
  const endDate = anchor.endDate;

  console.log(
    `Pay period: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)} (${periodIds.length} rule-set periods)`
  );

  // Get site timezone for the tenant
  const site = await db.site.findFirst({
    where: { tenantId: anchor.tenantId, isActive: true },
    select: { timezone: true },
  });
  const tz = site?.timezone ?? "America/New_York";

  // Load all timesheets across all matching sub-periods.
  // Some employees may have >1 timesheet for the same period (data migration issue) —
  // we merge all of them so no data is missed.
  const rawTimesheets = await db.timesheet.findMany({
    where: { payPeriodId: { in: periodIds } },
    select: {
      id: true,
      employeeId: true,
      employee: {
        select: {
          wmsId: true,
          user: { select: { name: true } },
          ruleSet: {
            select: {
              defaultPayCode: { select: { expressCode: true, label: true } },
            },
          },
        },
      },
      punches: {
        where: { isApproved: true, correctedById: null, isRejected: false },
        orderBy: { roundedTime: "asc" },
        select: {
          punchType: true,
          roundedTime: true,
          payCode: { select: { expressCode: true, label: true } },
        },
      },
      segments: {
        where: { segmentType: "WORK" },
        select: {
          segmentDate: true,
          durationMinutes: true,
          payBucket: true,
          payBucketOverride: true,
          payCode: { select: { expressCode: true, label: true } },
        },
      },
    },
    orderBy: { employee: { user: { name: "asc" } } },
  });

  // Merge duplicate timesheets per employee
  type RawTS = (typeof rawTimesheets)[number];
  const mergedMap = new Map<string, RawTS>();
  for (const ts of rawTimesheets) {
    const existing = mergedMap.get(ts.employeeId);
    if (!existing) {
      mergedMap.set(ts.employeeId, { ...ts });
    } else {
      // Merge punches (dedupe by rounded time + type)
      const punchKeys = new Set(existing.punches.map((p) => `${p.punchType}:${p.roundedTime.toISOString()}`));
      for (const p of ts.punches) {
        const k = `${p.punchType}:${p.roundedTime.toISOString()}`;
        if (!punchKeys.has(k)) { existing.punches.push(p); punchKeys.add(k); }
      }
      // Merge segments
      existing.segments.push(...ts.segments);
      if (rawTimesheets.indexOf(ts) !== rawTimesheets.indexOf(existing)) {
        console.log(`  Merged duplicate timesheet for ${ts.employee.user?.name ?? ts.employeeId}`);
      }
    }
  }
  const timesheets = Array.from(mergedMap.values()).sort(
    (a, b) => (a.employee.user?.name ?? "").localeCompare(b.employee.user?.name ?? "")
  );

  const rows: string[][] = [];
  const header = ["WMS ID", "Name", "Date", "Pay Code", "Punch In", "Punch Out", "REG", "OT", "DT"];
  rows.push(header);

  for (const ts of timesheets) {
    const emp = ts.employee;
    const wmsId = emp.wmsId ?? "";
    const name = emp.user?.name ?? "";

    // Group segments by date
    type DayBuckets = { reg: number; ot: number; dt: number; payCode: string };
    const byDate = new Map<string, DayBuckets>();

    for (const seg of ts.segments) {
      const dk = seg.segmentDate.toISOString().slice(0, 10);
      if (!byDate.has(dk)) byDate.set(dk, { reg: 0, ot: 0, dt: 0, payCode: "" });
      const d = byDate.get(dk)!;
      const bucket = seg.payBucketOverride ?? seg.payBucket;
      if (bucket === "REG") d.reg += seg.durationMinutes;
      else if (bucket === "OT") d.ot += seg.durationMinutes;
      else if (bucket === "DT") d.dt += seg.durationMinutes;
      if (seg.payCode) d.payCode = pcLabel(seg.payCode);
    }

    // Group punches by date — pair first CLOCK_IN and last CLOCK_OUT per day
    type DayPunches = { in: Date | null; out: Date | null; payCode: string };
    const punchByDate = new Map<string, DayPunches>();

    for (const p of ts.punches) {
      const isoKey = localDateKey(p.roundedTime, tz);
      if (!punchByDate.has(isoKey)) punchByDate.set(isoKey, { in: null, out: null, payCode: "" });
      const d = punchByDate.get(isoKey)!;
      if (p.punchType === "CLOCK_IN" && d.in === null) d.in = p.roundedTime;
      if (p.punchType === "CLOCK_OUT") d.out = p.roundedTime;
      if (p.payCode) d.payCode = pcLabel(p.payCode);
    }

    // Emit one row per day that has segment data
    const dates = Array.from(byDate.keys()).sort();
    for (const dk of dates) {
      const seg = byDate.get(dk)!;
      const punch = punchByDate.get(dk);
      const dateLabel = fmtDateLabel(dk);
      const payCode = punch?.payCode || seg.payCode || pcLabel(emp.ruleSet?.defaultPayCode);
      const punchIn = punch?.in ? fmt(punch.in, tz) : "";
      const punchOut = punch?.out ? fmt(punch.out, tz) : "";

      rows.push([
        wmsId,
        name,
        dateLabel,
        payCode,
        punchIn,
        punchOut,
        minsToHrs(seg.reg),
        minsToHrs(seg.ot),
        minsToHrs(seg.dt),
      ]);
    }
  }

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const filename = `timecard-export-${startDate.toISOString().slice(0, 10)}.csv`;
  writeFileSync(filename, csv);
  console.log(`Written: ${filename} (${rows.length - 1} rows)`);
}

main()
  .catch(console.error)
  .finally(async () => { await db.$disconnect(); await pool.end(); });
