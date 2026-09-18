/**
 * Reconciles live scan rows against backfilled ones for the same physical scan.
 *
 * Run:
 *   npx tsx scripts/reconcile-duplicate-scans.ts [--window 10] [--apply]
 *
 * Without --apply it reports what it would change and writes nothing.
 *
 * <b>The problem.</b> `scan_events` went live on 2026-09-15 and the legacy
 * reports were backfilled on 2026-09-17, so roughly two days overlap. In that
 * window one physical punch produced TWO rows: CloudTime's own, written when the
 * kiosk posted, and the backfilled one expanded from the legacy report. They are
 * not the same instant — the two systems timestamp independently and land about
 * a second apart — so the backfill's idempotency key could not match them and
 * inserted alongside instead of adopting.
 *
 * Measured after the backfill: 289 such pairs, 91 of which DISAGREE on
 * direction. The live row is the later of the two, so it sorts last and is what
 * "is this person in or out" returns — meaning the guessed direction still won
 * for 91 employees despite the backfill.
 *
 * <b>The rule.</b> Where a live ALTERNATION row sits within the window of a
 * SOURCE_COLUMN row for the same badge and stream, the source wins: the legacy
 * column stated the direction, CloudTime inferred it. The live row keeps its own
 * timestamp (it is a real record of when CloudTime saw the scan) but takes the
 * stated direction, and is marked SOURCE_COLUMN so nothing re-resolves it later.
 */

import path from "node:path";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

type Pairing = {
  liveId: string;
  badgeCode: string;
  stream: string;
  liveTime: string;
  liveDir: string;
  srcTime: string;
  srcDir: string;
  gap: string;
};

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const windowIdx = argv.indexOf("--window");
  const windowSec = windowIdx >= 0 ? Number(argv[windowIdx + 1]) : 10;

  if (!Number.isFinite(windowSec) || windowSec <= 0 || windowSec > 120) {
    console.error("--window must be a positive number of seconds, at most 120");
    process.exit(1);
  }

  // DISTINCT ON keeps the nearest source row when several fall inside the
  // window, so a live scan is never reconciled against a farther one.
  const pairs = await db.$queryRawUnsafe<Pairing[]>(`
    SELECT DISTINCT ON (a."id")
           a."id"          AS "liveId",
           a."badgeCode"   AS "badgeCode",
           a."stream"::text AS "stream",
           a."scanTime"::text AS "liveTime",
           a."direction"::text AS "liveDir",
           b."scanTime"::text AS "srcTime",
           b."direction"::text AS "srcDir",
           ABS(EXTRACT(EPOCH FROM (a."scanTime" - b."scanTime")))::text AS "gap"
    FROM   "scan_events" a
    JOIN   "scan_events" b
      -- Paired on the EMPLOYEE, not the badge string. Two badge formats are in
      -- circulation — a 6-digit employee number and a 10-digit barcode — and the
      -- legacy report records the former while a kiosk records whichever was
      -- scanned. 140 employees hold rows under both, so joining on badgeCode
      -- silently skipped exactly the people most affected: their backfilled row
      -- and their live row look like different badges entirely.
      ON   (
             (a."employeeId" IS NOT NULL AND b."employeeId" = a."employeeId")
             OR (a."employeeId" IS NULL AND b."badgeCode" = a."badgeCode")
           )
     AND   b."stream"    = a."stream"
     AND   b."directionSource" = 'SOURCE_COLUMN'
     AND   b."scanTime" BETWEEN a."scanTime" - interval '${windowSec} seconds'
                            AND a."scanTime" + interval '${windowSec} seconds'
    WHERE  a."directionSource" = 'ALTERNATION'
    ORDER  BY a."id", ABS(EXTRACT(EPOCH FROM (a."scanTime" - b."scanTime")))
  `);

  const disagreeing = pairs.filter((p) => p.liveDir !== p.srcDir);
  const agreeing = pairs.filter((p) => p.liveDir === p.srcDir);

  console.log(`window: ${windowSec}s`);
  console.log(`live rows pairing with a backfilled scan: ${pairs.length}`);
  console.log(`  direction already agrees: ${agreeing.length}  (marked SOURCE_COLUMN, value unchanged)`);
  console.log(`  direction DISAGREES:      ${disagreeing.length}  (value corrected)`);

  const byStream: Record<string, number> = {};
  for (const p of disagreeing) byStream[p.stream] = (byStream[p.stream] ?? 0) + 1;
  if (Object.keys(byStream).length) console.log(`  corrections by stream: ${JSON.stringify(byStream)}`);

  console.log("\nsample corrections:");
  for (const p of disagreeing.slice(0, 8)) {
    console.log(`  badge ${p.badgeCode} ${p.stream}  live ${p.liveTime} ${p.liveDir} -> ${p.srcDir}  (source ${p.srcTime}, ${p.gap}s apart)`);
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to update ${pairs.length} rows.`);
    await db.$disconnect();
    return;
  }

  console.log(`\nupdating ${pairs.length} rows`);
  let corrected = 0;
  const CHUNK = 200;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    await db.$transaction(async (tx) => {
      for (const p of chunk) {
        await tx.scanEvent.update({
          where: { id: p.liveId },
          data: {
            direction: p.srcDir as "IN" | "OUT" | "UNKNOWN",
            directionSource: "SOURCE_COLUMN",
            note: `direction taken from the legacy report row ${p.gap}s away; CloudTime had inferred ${p.liveDir}`,
          },
        });
        corrected++;
      }
    }, { timeout: 120_000 });
  }

  console.log(`done: ${corrected} rows reconciled`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
