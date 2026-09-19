/**
 * Who is affected by the badge-matching gap, as one CSV.
 *
 * Run:
 *   npx tsx scripts/report-badge-affected.ts --out <path.csv>
 *     [--gap <roster-gap-badges.csv>] [--scanlog <timestationscanlog.csv>]
 *
 * Read-only. Writes nothing to the database.
 *
 * <b>Three different problems wear the same symptom</b> — a scan that does not
 * land on anybody — and they need different fixes, so the report separates them
 * rather than handing over one undifferentiated list:
 *
 *   A_BARCODE_MISSING   The person IS in CloudTime and we know the barcode they
 *                       scanned. Fixed by load-barcodes.ts. No data entry.
 *   B_NOT_IN_CLOUDTIME  The badge appears in the gate log but resolves to no
 *                       employee here. Needs an employee record, or is stale.
 *   C_BARCODE_UNKNOWN   In CloudTime with an employee number but no barcode on
 *                       file. Works today only because they scan the 6-digit
 *                       number; the moment they scan the printed barcode it
 *                       fails. This is the population the Oracle export fixes.
 *
 * Category B is checked against the legacy API as well, because a badge neither
 * system can resolve is a retired badge rather than a missing employee, and
 * that distinction decides whether anyone has to do anything about it.
 */

import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
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

const LEGACY = "http://cajaapi.rex11.com/TimeClock/prod/employees";

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
  return rows.slice(1).filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

type Legacy = { name: string; department: string; terminated: string; found: boolean };

/** One legacy lookup. A failure is reported as not-found, never thrown: this is
 *  a report, and one flaky call must not cost the other 800 rows. */
async function legacyLookup(badge: string): Promise<Legacy> {
  const blank = { name: "", department: "", terminated: "", found: false };
  try {
    const res = await fetch(`${LEGACY}/${encodeURIComponent(badge)}/getinfo`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return blank;
    const json = (await res.json()) as { ResponseData?: Record<string, unknown> | null };
    const d = json.ResponseData;
    if (!d) return blank;
    return {
      name: `${d.FirstName ?? ""} ${d.LastName ?? ""}`.trim(),
      department: String(d.Description ?? ""),
      terminated: d.Terminated === 1 ? "YES" : d.Terminated === 0 ? "no" : "",
      found: true,
    };
  } catch {
    return blank;
  }
}

/** Small pool — the legacy API is a production dependency, not a load target. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const csvEscape = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const out = arg("out") ?? "badge-affected-employees.csv";
  const gapFile = arg("gap");
  const scanlogFile = arg("scanlog");

  type Row = {
    category: string; name: string; empId: string; barcodeScanned: string;
    barcodeOnFile: string; department: string; site: string; active: string;
    scansAffected: string; inLegacy: string; action: string;
  };
  const rows: Row[] = [];

  /* ---------- A: seen scanning, barcode known, person is in CloudTime ------ */
  if (gapFile) {
    const gap = parseCSV(readFileSync(gapFile, "utf8"));
    const empIds = [...new Set(gap.map((r) => r.oracle_empid).filter(Boolean))];
    const found = await db.employee.findMany({
      where: { wmsId: { in: empIds } },
      select: {
        wmsId: true, barcode: true, isActive: true,
        user: { select: { name: true } },
        department: { select: { name: true } },
        site: { select: { name: true } },
      },
    });
    const byWms = new Map(found.map((e) => [e.wmsId!, e]));
    for (const g of gap) {
      const e = byWms.get(g.oracle_empid);
      if (!e) continue;
      rows.push({
        category: "A_BARCODE_MISSING",
        name: e.user?.name ?? "",
        empId: g.oracle_empid,
        barcodeScanned: g.badge ?? "",
        barcodeOnFile: e.barcode ?? "",
        department: e.department?.name ?? "",
        site: e.site?.name ?? "",
        active: e.isActive ? "yes" : "NO",
        scansAffected: g.scans ?? "",
        inLegacy: "yes",
        action: "load barcode (scripts/load-barcodes.ts)",
      });
    }
    console.log(`A_BARCODE_MISSING  : ${rows.length}`);
  }

  /* ---------- B: in the gate log, resolves to nobody in CloudTime --------- */
  if (scanlogFile) {
    const gate = parseCSV(readFileSync(scanlogFile, "utf8"));
    const counts = new Map<string, number>();
    for (const r of gate) if (r.BADGEID) counts.set(r.BADGEID, (counts.get(r.BADGEID) ?? 0) + 1);
    const badges = [...counts.keys()];

    const known = await db.$queryRaw<Array<{ badge: string }>>`
      SELECT DISTINCT b AS badge FROM unnest(${badges}::text[]) b
      WHERE EXISTS (SELECT 1 FROM "employees" e
                    WHERE e."wmsId" = b OR e."barcode" = b OR e."barcode" = ltrim(b,'0'))`;
    const knownSet = new Set(known.map((k) => k.badge));
    const unmatched = badges.filter((b) => !knownSet.has(b));
    console.log(`B_NOT_IN_CLOUDTIME : ${unmatched.length} — checking each against the legacy API`);

    const legacy = await mapLimit(unmatched, 6, legacyLookup);
    unmatched.forEach((badge, i) => {
      const l = legacy[i];
      rows.push({
        category: "B_NOT_IN_CLOUDTIME",
        name: l.name,
        empId: badge,
        barcodeScanned: badge,
        barcodeOnFile: "",
        department: l.department,
        site: "",
        active: l.terminated === "YES" ? "NO" : l.found ? "yes" : "",
        scansAffected: String(counts.get(badge) ?? 0),
        inLegacy: l.found ? "yes" : "no",
        action: l.found ? "create employee in CloudTime" : "stale badge — neither system knows it",
      });
    });
    const inLegacy = legacy.filter((l) => l.found).length;
    console.log(`                     of those, ${inLegacy} exist in the legacy system, ${unmatched.length - inLegacy} do not`);
  }

  /* ---------- C: in CloudTime, employee number only, no barcode ----------- */
  const noBarcode = await db.employee.findMany({
    where: { wmsId: { not: null }, barcode: null },
    select: {
      wmsId: true, isActive: true,
      user: { select: { name: true } },
      department: { select: { name: true } },
      site: { select: { name: true } },
    },
    orderBy: { wmsId: "asc" },
  });
  const alreadyListed = new Set(rows.filter((r) => r.category === "A_BARCODE_MISSING").map((r) => r.empId));
  for (const e of noBarcode) {
    if (alreadyListed.has(e.wmsId!)) continue;
    rows.push({
      category: "C_BARCODE_UNKNOWN",
      name: e.user?.name ?? "",
      empId: e.wmsId!,
      barcodeScanned: "",
      barcodeOnFile: "",
      department: e.department?.name ?? "",
      site: e.site?.name ?? "",
      active: e.isActive ? "yes" : "NO",
      scansAffected: "0",
      inLegacy: "",
      action: "needs barcode from Oracle (wmsusers.barcode -> framewrk.users.empid)",
    });
  }
  console.log(`C_BARCODE_UNKNOWN  : ${rows.length - alreadyListed.size - rows.filter((r) => r.category === "B_NOT_IN_CLOUDTIME").length}`);

  const header = [
    "category", "name", "empId", "barcodeScanned", "barcodeOnFile",
    "department", "site", "active", "scansAffected", "inLegacy", "action",
  ];
  const body = rows
    .sort((a, b) => a.category.localeCompare(b.category) || Number(b.scansAffected) - Number(a.scansAffected))
    .map((r) => header.map((h) => csvEscape((r as unknown as Record<string, string>)[h])).join(","));
  writeFileSync(out, `${header.join(",")}\n${body.join("\n")}\n`, "utf8");

  const active = rows.filter((r) => r.active === "yes").length;
  console.log(`\nwrote ${rows.length} rows (${active} of them active employees) to ${out}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
