/**
 * Loads historical scans from the two legacy reports into `scan_events`.
 *
 * Run:
 *   npx tsx scripts/backfill-scan-events.ts --timeclock <path> --scanlog <path> [--apply]
 *
 * Without --apply it reports what it would do and writes nothing.
 *
 * <b>Why this exists.</b> `scan_events` infers a scan's direction by alternating
 * from the badge's previous scan. The legacy reports do not need inferring —
 * they state it. A timestamp in TIMECLOCKOUT is a departure by definition.
 * Replaying two months of them showed the inference disagreeing with the source
 * on 19.9% of time-clock events, and leaving 266 of 789 employees showing the
 * wrong current state. Every row written here carries SOURCE_COLUMN, so it is
 * fact rather than guess and nothing downstream may re-resolve it.
 *
 * <b>The reports are paired.</b> One report row is a whole shift — it holds both
 * the clock-in and the clock-out — while scan_events holds one row per scan.
 * Each source row therefore expands into up to two events.
 *
 * <b>It corrects, it does not only insert.</b> The table has been live since
 * 2026-09-15, so rows already exist for this period with guessed directions.
 * Where a live row and the report describe the same scan, the report wins.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { PrismaClient, type ScanDirection, type ScanStream } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

// Session pooler (DIRECT_URL), not the transaction pooler the app uses: this
// runs long multi-statement transactions, which the transaction pooler refuses.
const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * Badge matching, kept identical to src/lib/utils/badge-lookup.ts.
 *
 * Inlined rather than imported because that module pulls in the app's `@/lib/db`
 * singleton through a path alias, which would open a second pool on the
 * transaction pooler. The rule itself must not drift: a 6-digit employee number
 * matches wmsId literally, while a 10-digit barcode matches both as-scanned and
 * zero-stripped, because the tablets pad to ten characters and Oracle does not.
 */
function badgeWhere(code: string) {
  const trimmed = code.trim();
  const stripped = trimmed.replace(/^0+/, "");
  const candidates = stripped && stripped !== trimmed ? [trimmed, stripped] : [trimmed];
  return { OR: [{ wmsId: trimmed }, { barcode: { in: candidates } }] };
}

function findEmployeeIdentityByBadge(code: string) {
  return db.employee.findFirst({
    where: badgeWhere(code),
    select: { id: true, tenantId: true, site: { select: { timezone: true } } },
  });
}

/* ---------------------------------------------------------------- */
/*  CSV                                                              */
/* ---------------------------------------------------------------- */

/**
 * RFC4180 parser. Hand-rolled because these files genuinely need it: four of
 * the 35 device names contain embedded newlines (one holds six), so any
 * line-based split corrupts the file.
 */
function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false; continue;
      }
      field += c; continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadRows(path: string): Record<string, string>[] {
  const rows = parseCSV(readFileSync(path, "utf8"));
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** "8/14/2026 7:02:17 AM" in the site's local zone → UTC instant. */
function parseLocal(stamp: string, timezone: string): Date | null {
  if (!stamp?.trim()) return null;
  const m = stamp.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i,
  );
  if (!m) throw new Error(`unparseable timestamp: ${stamp}`);

  const [, mo, d, y, hh, mi, ss, ap] = m;
  let hour = Number(hh);
  if (ap) {
    const upper = ap.toUpperCase();
    if (upper === "PM" && hour !== 12) hour += 12;
    if (upper === "AM" && hour === 12) hour = 0;
  }

  // Offset inversion: read the naive stamp as if UTC, ask what that instant
  // looks like in the target zone, and correct by the difference.
  const asIfUtc = new Date(Date.UTC(+y, +mo - 1, +d, hour, +mi, +ss));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(asIfUtc);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  let h24 = get("hour");
  if (h24 === 24) h24 = 0;
  const seenLocal = Date.UTC(get("year"), get("month") - 1, get("day"), h24, get("minute"), get("second"));
  return new Date(2 * asIfUtc.getTime() - seenLocal);
}

const clean = (s: string | undefined) =>
  (s ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() || null;

/* ---------------------------------------------------------------- */
/*  Expansion                                                        */
/* ---------------------------------------------------------------- */

type Event = {
  badgeCode: string;
  stream: ScanStream;
  direction: ScanDirection;
  scanTime: Date;
  deviceName: string | null;
  site: string | null;
  sourceSlot: string;
  sourceRef: string;
};

function expand(
  timeclockPath: string | undefined,
  scanlogPath: string | undefined,
  timezone: string,
): Event[] {
  const events: Event[] = [];

  for (const r of timeclockPath ? loadRows(timeclockPath) : []) {
    const badgeCode = r.EMPID?.trim();
    if (!badgeCode) continue;
    const common = {
      badgeCode, stream: "TIME_CLOCK" as ScanStream,
      deviceName: clean(r.DEVICENAME), site: clean(r.WAREHOUSE), sourceRef: r.SCANID?.trim() ?? "",
    };
    const inAt = parseLocal(r.TIMECLOCKIN, timezone);
    const outAt = parseLocal(r.TIMECLOCKOUT, timezone);
    if (inAt) events.push({ ...common, direction: "IN", scanTime: inAt, sourceSlot: "TIMECLOCKIN" });
    if (outAt) events.push({ ...common, direction: "OUT", scanTime: outAt, sourceSlot: "TIMECLOCKOUT" });
  }

  for (const r of scanlogPath ? loadRows(scanlogPath) : []) {
    const badgeCode = r.BADGEID?.trim();
    if (!badgeCode) continue;
    const common = {
      badgeCode, stream: "SECURITY" as ScanStream,
      deviceName: null, site: clean(r.LOCATION), sourceRef: r.SCANID?.trim() ?? "",
    };
    // SCANTYPE is deliberately NOT read. Measured across 24,415 rows it
    // correlates perfectly with whether OUTTIME is populated, so it describes
    // whether the person has left yet — the row's state — not the direction of
    // the SCANTIME event. Using it as a direction would be wrong on every row.
    const inAt = parseLocal(r.SCANTIME, timezone);
    const outAt = parseLocal(r.OUTTIME, timezone);
    if (inAt) events.push({ ...common, direction: "IN", scanTime: inAt, sourceSlot: "SCANTIME" });
    if (outAt) events.push({ ...common, direction: "OUT", scanTime: outAt, sourceSlot: "OUTTIME" });
  }

  return events;
}

/* ---------------------------------------------------------------- */
/*  Load                                                             */
/* ---------------------------------------------------------------- */

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const timeclockPath = arg("timeclock");
  const scanlogPath = arg("scanlog");
  const timezone = arg("timezone") ?? "America/New_York";
  const apply = argv.includes("--apply");
  const lastOnly = argv.includes("--last-only");

  // Either report alone is valid. On a deployment day the gate report is the
  // urgent one — it is what the kiosk's IN/OUT alternates from — and waiting on
  // the time-clock export before correcting the anchors would cost exactly the
  // hours the load exists to protect.
  if (!timeclockPath && !scanlogPath) {
    console.error(
      "usage: [--timeclock <path>] [--scanlog <path>] (at least one) " +
        "[--timezone <tz>] [--last-only] [--apply]",
    );
    process.exit(1);
  }

  console.log(`reading reports (source timestamps read as ${timezone} local)`);
  const events = expand(timeclockPath, scanlogPath, timezone);
  console.log(`  expanded ${events.length} scan events from the two reports`);

  // Collapse on the idempotency key. What remains after this are distinct
  // physical scans: an IN and an OUT sharing a second survive as two rows
  // because sourceSlot differs, while a legacy row duplicated under several
  // SCANIDs collapses to one.
  const unique = new Map<string, Event>();
  for (const e of events) {
    unique.set(`${e.badgeCode}|${e.stream}|${e.scanTime.toISOString()}|${e.sourceSlot}`, e);
  }
  let rows = [...unique.values()].sort((a, b) => +a.scanTime - +b.scanTime);
  console.log(`  ${rows.length} distinct events after the idempotency key (${events.length - rows.length} duplicates collapsed)`);

  // --last-only: keep just each badge's final scan in each stream.
  //
  // This is the smaller, safer shape of the same fix. The whole history is only
  // needed to audit the past; what makes the kiosk and the reports agree today
  // is the final scan, because that is both what "is this person in or out"
  // reads and what the next live scan alternates from. One correct anchor per
  // badge per stream is enough to fix the present and everything after it.
  if (lastOnly) {
    const latest = new Map<string, Event>();
    for (const e of rows) {
      const key = `${e.badgeCode}|${e.stream}`;
      const held = latest.get(key);
      // On a tie, the departure wins: a shift row whose in and out share a
      // second ends with the person gone, not present.
      if (!held || e.scanTime > held.scanTime ||
          (+e.scanTime === +held.scanTime && e.direction === "OUT")) {
        latest.set(key, e);
      }
    }
    rows = [...latest.values()].sort((a, b) => +a.scanTime - +b.scanTime);
    console.log(`  --last-only: reduced to ${rows.length} rows (one per badge per stream)`);
  }

  // Resolve badges once. Many thousands of events share a few hundred badges.
  const badges = [...new Set(rows.map((r) => r.badgeCode))];
  console.log(`resolving ${badges.length} distinct badges`);
  const identity = new Map<string, { id: string; tenantId: string } | null>();
  for (const badge of badges) {
    const employee = await findEmployeeIdentityByBadge(badge);
    identity.set(badge, employee ? { id: employee.id, tenantId: employee.tenantId } : null);
  }
  const unmatched = badges.filter((b) => !identity.get(b));
  console.log(`  matched ${badges.length - unmatched.length}, unmatched ${unmatched.length}`);
  if (unmatched.length) console.log(`  unmatched badges: ${unmatched.slice(0, 20).join(", ")}${unmatched.length > 20 ? " …" : ""}`);

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to load ${rows.length} rows.`);
    await db.$disconnect();
    return;
  }

  console.log(`\nwriting ${rows.length} rows`);
  let created = 0, corrected = 0, adopted = 0, unchanged = 0;

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.$transaction(async (tx) => {
      for (const e of chunk) {
        const who = identity.get(e.badgeCode);
        const data = {
          tenantId: who?.tenantId ?? null,
          employeeId: who?.id ?? null,
          badgeCode: e.badgeCode,
          stream: e.stream,
          direction: e.direction,
          directionSource: "SOURCE_COLUMN" as const,
          scanTime: e.scanTime,
          deviceName: e.deviceName,
          site: e.site,
          sourceSlot: e.sourceSlot,
          sourceRef: e.sourceRef,
          // These scans predate CloudTime's pipeline, so no punch was ever
          // going to come of them. PENDING would have the discrepancy sweep
          // chase punches that cannot exist.
          outcome: "NOT_APPLICABLE" as const,
          note: who ? null : "no employee matches this badge",
        };

        let existing = await tx.scanEvent.findUnique({
          where: {
            badgeCode_stream_scanTime_sourceSlot: {
              badgeCode: e.badgeCode, stream: e.stream,
              scanTime: e.scanTime, sourceSlot: e.sourceSlot,
            },
          },
          select: { id: true, direction: true, directionSource: true },
        });

        // Adopt the live row for this same physical scan, if there is one.
        //
        // The table has been taking live kiosk scans since 2026-09-15, and those
        // rows carry sourceSlot 'LIVE'. A report row for the same scan carries
        // 'TIMECLOCKOUT' or similar, so the lookup above misses it and we would
        // insert a SECOND row for one scan — with the opposite direction, since
        // correcting that is the whole point. Claim the live row instead.
        //
        // Restricted to sourceSlot 'LIVE' so a legitimate same-second IN and OUT
        // (393 such pairs exist) still land as the two distinct rows they are:
        // the first report row adopts the live one, the second creates.
        if (!existing) {
          const live = await tx.scanEvent.findFirst({
            where: {
              badgeCode: e.badgeCode, stream: e.stream,
              scanTime: e.scanTime, sourceSlot: "LIVE",
            },
            select: { id: true, direction: true, directionSource: true },
          });
          if (live) {
            await tx.scanEvent.update({ where: { id: live.id }, data });
            adopted++;
            continue;
          }
        }

        if (!existing) {
          await tx.scanEvent.create({ data });
          created++;
        } else if (existing.direction !== e.direction || existing.directionSource !== "SOURCE_COLUMN") {
          // A live row guessed this one. The report states it, so the report wins.
          await tx.scanEvent.update({ where: { id: existing.id }, data });
          corrected++;
        } else {
          unchanged++;
        }
      }
    }, { timeout: 120_000 });

    if ((i / CHUNK) % 10 === 0) {
      console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
    }
  }

  console.log(`\ndone: ${created} created, ${corrected} corrected, ${unchanged} already correct`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
