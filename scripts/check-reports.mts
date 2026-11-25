/**
 * Every report, checked the way the app runs it. READ ONLY: it runs reports
 * and writes nothing, not even a run record.
 *
 *   npm run check:reports                  every standard report and every report type
 *   npm run check:reports -- --saved       the company's saved reports too
 *   npm run check:reports -- --only daily  only the cases whose name holds "daily"
 *
 * For each one, the editor's 100 row preview and the full run, on the
 * company with the most people, for the report's own dates (a current week,
 * month or pay period is read as the last complete one, so live clock ins
 * do not move the data between the two runs). It fails when:
 *
 *  - the preview is not exactly the first rows of the full report;
 *  - a run builds more than FORMATTERS_PER_RUN date formatters (one built
 *    per line is how a report reached 57,000 a run and the live server's 5
 *    minute limit, Nov 24, 2026; this count does not depend on the machine);
 *  - a preview takes over PREVIEW_SECONDS or a full run over FULL_SECONDS,
 *    twice in a row (the database is shared, so one slow run is not enough).
 *
 * Run it before pushing a new report type or a change to one. The times are
 * a Mac's against the shared database; the live server is slower at the
 * work in between, which is why the budgets sit well under its limit.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// Set to catch a report several times slower than today, not the shared
// database's swings: the heaviest preview (the monthly attendance summary)
// ran anywhere from 3 to 10 s on a Mac on Nov 25, 2026.
const PREVIEW_SECONDS = 10;
const FULL_SECONDS = 30;
const FORMATTERS_PER_RUN = 100;

let built = 0;
const RealDTF = Intl.DateTimeFormat;
(Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = new Proxy(RealDTF, {
  construct(t, a) { built++; return Reflect.construct(t, a); },
  apply(t, th, a) { built++; return Reflect.apply(t, th, a as unknown[]); },
});

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;

const { db } = await import("../src/lib/db");
const { getDataSource, getAllDataSources } = await import("../src/lib/reports/data-sources/index");
const { STANDARD_REPORTS } = await import("../src/lib/reports/standard-reports");
const { withCreatorSites } = await import("../src/lib/reports/creator-sites");

const biggest = await db.employee.groupBy({ by: ["tenantId"], _count: { _all: true }, orderBy: { _count: { tenantId: "desc" } }, take: 1 });
const tenantId = biggest[0]?.tenantId;
if (!tenantId) { console.log("No company with people to check against."); process.exit(1); }
const lastPeriod = await db.payPeriod.findFirst({
  where: { tenantId, endDate: { lt: new Date() } }, orderBy: { endDate: "desc" }, select: { id: true },
});

type Range = Record<string, unknown>;
const rangeFor = (dates?: string): Range =>
  dates === "previousWeek" || dates === "currentWeek" || dates === "last7Days" ? { type: "calendar", unit: "week", which: "last" }
  : dates === "previousMonth" || dates === "currentMonth" ? { type: "calendar", unit: "month", which: "last" }
  : dates === "currentYear" ? { type: "calendar", unit: "year", which: "this" }
  : dates === "yesterday" ? { type: "yesterday" }
  : lastPeriod ? { type: "payPeriod", payPeriodId: lastPeriod.id, allGroups: true }
  : { type: "calendar", unit: "week", which: "last" };
// Saved reports keep their dates, except a moving window, read as last week.
const settled = (range: Range): Range => (range?.type === "relative" ? rangeFor("last7Days") : range);

type Case = { name: string; source: string; cfg: Record<string, unknown>; owner?: string };
const cases: Case[] = [];
for (const st of STANDARD_REPORTS) {
  const s = st as unknown as Record<string, unknown> & { id: string; source: string; dates?: string; filters?: { value: unknown }[] };
  cases.push({
    name: `standard "${s.id}"`, source: s.source,
    cfg: {
      columns: s.columns, groupBy: s.groupBy ?? [], sortBy: s.sortBy ?? [], layout: s.layout, across: s.across,
      // A standard report's pick filters start empty: the editor leaves them out.
      filters: (s.filters ?? []).filter((f) => !(Array.isArray(f.value) ? f.value.length === 0 : f.value == null || String(f.value).trim() === "")),
      dateRange: rangeFor(s.dates),
    },
  });
}
// Every report type with all its columns, so a new type is checked before it has a standard report.
for (const def of getAllDataSources()) {
  cases.push({ name: `type ${def.id}`, source: def.id, cfg: { columns: def.columns.map((c) => c.id), filters: [], groupBy: [], sortBy: [], dateRange: rangeFor("previousWeek") } });
}
if (args.includes("--saved")) {
  for (const r of await db.reportDefinition.findMany({ where: { tenantId }, select: { name: true, dataSource: true, config: true, ownerId: true } })) {
    const c = r.config as Record<string, unknown>;
    cases.push({ name: `saved "${r.name}"`, source: r.dataSource, cfg: { ...c, dateRange: settled(c.dateRange as Range) }, owner: r.ownerId });
  }
}

const shape = (row: unknown) =>
  JSON.stringify(row, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));

async function timed(source: string, cfg: Record<string, unknown>) {
  built = 0;
  const t0 = performance.now();
  const result = await getDataSource(source as never).execute(cfg as never, tenantId!);
  return { result, seconds: (performance.now() - t0) / 1000, formatters: built };
}

const failures: string[] = [];
const lines: { seconds: number; text: string }[] = [];
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  try {
    const base = c.owner ? await withCreatorSites(c.cfg as never, c.owner) : c.cfg;
    let preview = await timed(c.source, { ...base, limit: 100 });
    let full = await timed(c.source, { ...base, limit: 5000 });
    // Over a time budget once is the shared database as often as the report: run it again.
    if (preview.seconds > PREVIEW_SECONDS || full.seconds > FULL_SECONDS) {
      const p2 = await timed(c.source, { ...base, limit: 100 });
      const f2 = await timed(c.source, { ...base, limit: 5000 });
      if (p2.seconds < preview.seconds) preview = { ...p2, formatters: preview.formatters };
      if (f2.seconds < full.seconds) full = { ...f2, formatters: full.formatters };
    }
    const problems: string[] = [];
    const head = full.result.rows.slice(0, preview.result.rows.length).map(shape);
    const at = preview.result.rows.map(shape).findIndex((row, i) => row !== head[i]);
    if (at >= 0) problems.push(`preview row ${at + 1} is not the full report's row ${at + 1}`);
    const formatters = Math.max(preview.formatters, full.formatters);
    if (formatters > FORMATTERS_PER_RUN) problems.push(`built ${formatters} date formatters in one run (most allowed ${FORMATTERS_PER_RUN})`);
    if (preview.seconds > PREVIEW_SECONDS) problems.push(`preview took ${preview.seconds.toFixed(1)} s (budget ${PREVIEW_SECONDS} s)`);
    if (full.seconds > FULL_SECONDS) problems.push(`full run took ${full.seconds.toFixed(1)} s (budget ${FULL_SECONDS} s)`);
    for (const p of problems) failures.push(`${c.name}: ${p}`);
    lines.push({
      seconds: Math.max(preview.seconds, full.seconds),
      text: `${problems.length ? "FAIL" : "ok  "}  preview ${preview.seconds.toFixed(2).padStart(5)} s  full ${full.seconds.toFixed(2).padStart(5)} s  ${String(full.result.rows.length).padStart(5)} rows  ${String(formatters).padStart(4)} fmt  ${c.name}`,
    });
  } catch (e) {
    failures.push(`${c.name}: did not run (${(e as Error).message.slice(0, 120)})`);
    lines.push({ seconds: Infinity, text: `FAIL  did not run  ${c.name}` });
  }
}

for (const l of lines.sort((a, b) => b.seconds - a.seconds)) console.log(l.text);
console.log(failures.length ? `\n${failures.length} problem(s):\n${failures.map((f) => `  ${f}`).join("\n")}` : `\nAll ${lines.length} reports pass.`);
process.exit(failures.length ? 1 : 0);
