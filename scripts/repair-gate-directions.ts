/**
 * Replaces guessed gate directions with the direction Oracle stated at the time.
 *
 * Run:
 *   npx tsx scripts/repair-gate-directions.ts [--apply]
 *
 * Without --apply it reports what it would change and writes nothing.
 *
 * <b>Why this is possible without an export.</b> Every live gate row already
 * carries Oracle's verdict in `legacyScanType` — the tablet sends it on each
 * scan and the ingest route has always stored it, purely so the two could be
 * compared. The comparison is what found the problem; the same column is what
 * repairs it. No report needs pulling.
 *
 * <b>What went wrong.</b> The gate stream has no daily re-anchor — deliberately,
 * because night shift crosses midnight — so alternation there never re-syncs.
 * After the 2026-09-18 mid-day rollout the first crossing each tablet witnessed
 * was people leaving at lunch, not arriving, so the chain started a phase out
 * and stayed there: 87 of 129 badges came out the exact inverse of Oracle end to
 * end. The inference was not broken; it was out of step, which is worse, because
 * it looks orderly.
 *
 * <b>Scope.</b> SECURITY only. TIME_CLOCK re-anchors at local midnight and shows
 * zero mismatches across every clock in the estate, so it is left alone.
 *
 * Rows are marked SOURCE_COLUMN once repaired, which makes each of them an
 * anchor rather than a link in a chain — `reresolveFollowing` skips them by
 * design, so nothing downstream can drag them back out of phase.
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

async function main() {
  const apply = process.argv.includes("--apply");

  const before = await db.$queryRaw<
    Array<{ src: string; has_legacy: boolean; rows: bigint; wrong: bigint }>
  >`
    SELECT s."directionSource"::text          AS src,
           (s."legacyScanType" IS NOT NULL)   AS has_legacy,
           COUNT(*)                           AS rows,
           COUNT(*) FILTER (WHERE s."legacyMismatch") AS wrong
    FROM   "scan_events" s
    WHERE  s."stream" = 'SECURITY' AND s."sourceSlot" = 'LIVE'
    GROUP  BY 1, 2 ORDER BY 3 DESC`;

  console.log("live SECURITY rows before:");
  for (const r of before) {
    console.log(
      `  ${r.src.padEnd(14)} oracle answer present=${String(r.has_legacy).padEnd(5)} ` +
        `rows=${String(r.rows).padStart(4)}  wrong=${r.wrong}`,
    );
  }

  const target = await db.$queryRaw<Array<{ n: bigint; wrong: bigint }>>`
    SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE s."legacyMismatch") AS wrong
    FROM   "scan_events" s
    WHERE  s."stream" = 'SECURITY'
      AND  s."sourceSlot" = 'LIVE'
      AND  s."directionSource" = 'ALTERNATION'
      AND  s."legacyScanType" IS NOT NULL`;

  const n = Number(target[0].n);
  const wrong = Number(target[0].wrong);
  console.log(`\nrepairable rows : ${n}`);
  console.log(`  of those, direction currently disagrees with Oracle : ${wrong}`);
  console.log(`  the rest already agree — they only change provenance to SOURCE_COLUMN`);

  const orphans = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM "scan_events" s
    WHERE s."stream" = 'SECURITY' AND s."sourceSlot" = 'LIVE'
      AND s."directionSource" = 'ALTERNATION' AND s."legacyScanType" IS NULL`;
  console.log(
    `\nleft as guesses (queued offline, Oracle never answered) : ${Number(orphans[0].n)}`,
  );
  console.log("  these stay ALTERNATION; the next real scan re-anchors that badge anyway");

  if (!apply) {
    const sample = await db.$queryRaw<
      Array<{ badge: string; from: string; to: string; at: Date }>
    >`
      SELECT s."badgeCode" AS badge, s."direction"::text AS from,
             s."legacyScanType" AS to, s."scanTime" AS at
      FROM   "scan_events" s
      WHERE  s."stream" = 'SECURITY' AND s."sourceSlot" = 'LIVE'
        AND  s."directionSource" = 'ALTERNATION'
        AND  s."legacyScanType" IS NOT NULL AND s."legacyMismatch"
      ORDER  BY s."scanTime" DESC LIMIT 8`;
    console.log("\nsample of what would change:");
    for (const s of sample) {
      console.log(`  badge ${s.badge.padEnd(11)} ${s.from} -> ${s.to}   (${s.at.toISOString()})`);
    }
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to repair ${n} rows.`);
    await db.$disconnect();
    return;
  }

  console.log(`\nrepairing ${n} rows`);
  const updated = await db.$executeRaw`
    UPDATE "scan_events" s
    SET    "direction"       = s."legacyScanType"::"ScanDirection",
           "directionSource" = 'SOURCE_COLUMN',
           "legacyMismatch"  = false,
           "note"            = CASE
             WHEN s."legacyMismatch"
               THEN 'direction restated from the gate API answer recorded with this scan; '
                    || 'CloudTime had inferred ' || s."direction"::text
             ELSE s."note"
           END
    WHERE  s."stream" = 'SECURITY'
      AND  s."sourceSlot" = 'LIVE'
      AND  s."directionSource" = 'ALTERNATION'
      AND  s."legacyScanType" IS NOT NULL`;

  console.log(`done: ${updated} rows repaired`);

  const after = await db.$queryRaw<Array<{ src: string; rows: bigint; wrong: bigint }>>`
    SELECT s."directionSource"::text AS src, COUNT(*) AS rows,
           COUNT(*) FILTER (WHERE s."legacyMismatch") AS wrong
    FROM   "scan_events" s
    WHERE  s."stream" = 'SECURITY' AND s."sourceSlot" = 'LIVE'
    GROUP  BY 1 ORDER BY 2 DESC`;
  console.log("\nlive SECURITY rows after:");
  for (const r of after) {
    console.log(`  ${r.src.padEnd(14)} rows=${String(r.rows).padStart(4)}  wrong=${r.wrong}`);
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
