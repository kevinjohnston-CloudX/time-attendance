/**
 * Teaches CloudTime the barcode physically printed on each badge.
 *
 * Run:
 *   npx tsx scripts/load-barcodes.ts --file <path> [--apply]
 *
 * Without --apply it reports what it would change and writes nothing.
 *
 * <b>Why this exists.</b> Two badge formats are in circulation: a 6-digit
 * employee number and a 10-digit barcode. The tablets send whichever was
 * scanned, and Oracle resolves the second to the first through
 * `wmsusers.barcode -> framewrk.users.empid`. CloudTime has no such step, so it
 * can only match a barcode it has been told about — and it has been told about
 * 207 of 7,967 employees. Measured against production, 6-digit scans match
 * 96-100% of the time while 10-digit scans match 37%.
 *
 * <b>Why the mismatch is not merely cosmetic.</b> A scan CloudTime cannot
 * resolve is stored with no employee attached, and direction is alternated per
 * employee — so an unmatched scan gets no direction at all, and the legacy
 * report cannot repair it afterwards because the report is keyed by employee
 * number while the unmatched row is keyed by barcode. The two describe one
 * person that CloudTime sees as two.
 *
 * <b>What it will not do.</b> It never touches a row with barcodeOverride set:
 * that flag means a human corrected the value by hand, and the point of the
 * flag is that a bulk load does not silently undo them. Nor will it move a
 * barcode off one employee onto another — `barcode` is unique, and a collision
 * means the export disagrees with itself, which is for a human to look at
 * rather than a script to guess at.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

// Session pooler (DIRECT_URL), not the transaction pooler the app uses: this
// runs multi-statement transactions, which the transaction pooler refuses.
const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

/** RFC4180 enough for these exports — quoted fields, embedded commas. */
function parseCSV(text: string): Record<string, string>[] {
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
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/**
 * These exports come from several places and none of them agree on a header.
 * Matching a list of known spellings beats demanding one, because the cost of
 * guessing wrong is a run that silently loads nothing.
 */
function pick(row: Record<string, string>, names: string[]): string | undefined {
  for (const key of Object.keys(row)) {
    if (names.includes(key.toLowerCase().replace(/[^a-z]/g, ""))) {
      const v = row[key]?.trim();
      if (v) return v;
    }
  }
  return undefined;
}

const BARCODE_KEYS = ["barcode", "badge", "badgeid", "badgecode", "scancode"];
const EMPID_KEYS = ["empid", "oracleempid", "wmsid", "employeeid", "employeenumber", "empno"];

async function main() {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--file");
  const file = idx >= 0 ? argv[idx + 1] : undefined;
  const apply = argv.includes("--apply");

  if (!file) {
    console.error("usage: --file <path.csv> [--apply]");
    console.error("  CSV needs a barcode column and an employee-number column.");
    console.error(`  barcode: ${BARCODE_KEYS.join(" / ")}`);
    console.error(`  empId:   ${EMPID_KEYS.join(" / ")}`);
    process.exit(1);
  }

  const rows = parseCSV(readFileSync(file, "utf8"));
  console.log(`read ${rows.length} rows from ${path.basename(file)}`);

  // Collapse to one barcode per employee. A badge-history export repeats an
  // employee once per badge ever issued; the last row wins, which is the
  // current badge as long as the export is chronological.
  const wanted = new Map<string, string>();
  let unusable = 0;
  for (const r of rows) {
    const barcode = pick(r, BARCODE_KEYS);
    const empId = pick(r, EMPID_KEYS);
    if (!barcode || !empId || !/^[0-9]+$/.test(barcode) || !/^[0-9]+$/.test(empId)) {
      unusable++;
      continue;
    }
    wanted.set(empId, barcode);
  }
  console.log(
    `  ${wanted.size} employees with a usable numeric barcode (${unusable} rows skipped)`,
  );
  if (!wanted.size) {
    console.error("nothing to load — check the column names against the list above");
    await db.$disconnect();
    process.exit(1);
  }

  const employees = await db.employee.findMany({
    where: { wmsId: { in: [...wanted.keys()] } },
    select: { id: true, wmsId: true, barcode: true, barcodeOverride: true },
  });
  const byWmsId = new Map(employees.map((e) => [e.wmsId!, e]));

  // Every barcode already spoken for, so a collision is reported rather than
  // thrown halfway through the write.
  const holders = await db.employee.findMany({
    where: { barcode: { in: [...wanted.values()] } },
    select: { id: true, wmsId: true, barcode: true },
  });
  const barcodeOwner = new Map(holders.map((e) => [e.barcode!, e]));

  const toSet: Array<{ id: string; wmsId: string; barcode: string; from: string | null }> = [];
  let alreadyCorrect = 0;
  let noEmployee = 0;
  let overridden = 0;
  const conflicts: string[] = [];

  for (const [empId, barcode] of wanted) {
    const employee = byWmsId.get(empId);
    if (!employee) { noEmployee++; continue; }
    if (employee.barcode === barcode) { alreadyCorrect++; continue; }
    if (employee.barcodeOverride) { overridden++; continue; }

    const owner = barcodeOwner.get(barcode);
    if (owner && owner.id !== employee.id) {
      conflicts.push(`barcode ${barcode} claimed by empId ${empId}, already held by empId ${owner.wmsId}`);
      continue;
    }
    toSet.push({ id: employee.id, wmsId: empId, barcode, from: employee.barcode });
  }

  console.log(`\n  would set barcode        : ${toSet.length}`);
  console.log(`  already correct          : ${alreadyCorrect}`);
  console.log(`  set by hand, left alone  : ${overridden}`);
  console.log(`  no employee in CloudTime : ${noEmployee}`);
  console.log(`  conflicts (not written)  : ${conflicts.length}`);
  for (const c of conflicts.slice(0, 10)) console.log(`      ${c}`);

  if (toSet.length) {
    console.log(`\n  sample of what would change:`);
    for (const t of toSet.slice(0, 8)) {
      console.log(`      empId ${t.wmsId.padEnd(9)} barcode ${t.from ?? "(none)"} -> ${t.barcode}`);
    }
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to update ${toSet.length} employees.`);
    await db.$disconnect();
    return;
  }

  console.log(`\nwriting ${toSet.length} barcodes`);
  const now = new Date();
  let written = 0;
  const CHUNK = 200;
  for (let n = 0; n < toSet.length; n += CHUNK) {
    await db.$transaction(
      async (tx) => {
        for (const t of toSet.slice(n, n + CHUNK)) {
          await tx.employee.update({
            where: { id: t.id },
            data: { barcode: t.barcode, barcodeSyncedAt: now },
          });
          written++;
        }
      },
      { timeout: 120_000 },
    );
  }

  console.log(`done: ${written} employees now resolvable by the barcode on their badge`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
