import { db } from "@/lib/db";
import { decryptPii } from "@/lib/crypto/pii";
import { photoUrls } from "@/lib/presence/photos";
import { createSignedUrl } from "@/lib/supabase-storage";
import { readablePii } from "./data-protection";
import { csvLine, ZipStream } from "./zip-stream";

/**
 * Everything CloudTime holds for one company, as one ZIP of CSV files, so the
 * company can take its data to another system (EU Data Act, switching
 * provider). One file per table, every column, times in ISO 8601 UTC so a
 * program reads them back exactly; an index of files and a note on what is
 * left out close the ZIP.
 *
 * <p>Server only, after the action has checked COMPANY_DATA_EXPORT. Every
 * table is held to the company in SQL: by its own company column, or through
 * the person, timesheet or setting it belongs to. The company id is the only
 * value passed in, as a parameter; table and column names are fixed here.
 *
 * <p>Read in pages of {@link PAGE} rows and streamed, so memory stays flat
 * and other requests are served in between. Left out: sign in secrets
 * (passwords, sessions, tokens, key hashes) and CloudTime's own system logs.
 */

const PAGE = 2000;

/** How a table is held to the company. `t` is the table, `$1` the company. */
const OWN = `t."tenantId" = $1`;
const PERSON = `t."employeeId" IN (SELECT id FROM employees WHERE "tenantId" = $1)`;
const TIMESHEET = `t."timesheetId" IN (SELECT ts.id FROM timesheets ts JOIN employees e ON e.id = ts."employeeId" WHERE e."tenantId" = $1)`;
const via = (column: string, table: string) => `t."${column}" IN (SELECT id FROM ${table} WHERE "tenantId" = $1)`;

export interface ExportTable {
  /** File name in the ZIP, without .csv. */
  file: string;
  table: string;
  group: ExportGroup;
  where: string;
  /** Columns never exported: secrets. */
  omit?: string[];
  /** False for link tables with no id column: read in one go (they are small). */
  paged?: boolean;
}

export type ExportGroup = "Company setup" | "People" | "Time" | "Leave" | "Reports" | "History and connections";

export const EXPORT_TABLES: ExportTable[] = [
  { file: "company", table: "tenants", group: "Company setup", where: `t.id = $1` },
  { file: "sites", table: "sites", group: "Company setup", where: OWN },
  { file: "departments", table: "departments", group: "Company setup", where: OWN },
  { file: "department_sites", table: "department_sites", group: "Company setup", where: via("siteId", "sites"), paged: false },
  { file: "job_titles", table: "job_titles", group: "Company setup", where: OWN },
  { file: "agencies", table: "agencies", group: "Company setup", where: OWN },
  { file: "shifts", table: "shifts", group: "Company setup", where: OWN },
  { file: "rule_sets", table: "rule_sets", group: "Company setup", where: OWN },
  { file: "pay_codes", table: "pay_codes", group: "Company setup", where: OWN },
  { file: "reason_codes", table: "reason_codes", group: "Company setup", where: OWN },
  { file: "pay_categories", table: "pay_categories", group: "Company setup", where: OWN },
  { file: "pay_category_leave_types", table: "pay_category_leave_types", group: "Company setup", where: via("payCategoryId", "pay_categories"), paged: false },
  { file: "pay_category_pto_policies", table: "pay_category_pto_policies", group: "Company setup", where: via("payCategoryId", "pay_categories"), paged: false },
  { file: "pay_types", table: "pay_types", group: "Company setup", where: OWN },
  { file: "leave_types", table: "leave_types", group: "Company setup", where: OWN },
  { file: "holidays", table: "holidays", group: "Company setup", where: OWN },
  { file: "holiday_rules", table: "holiday_rules", group: "Company setup", where: OWN },
  { file: "holiday_rule_holidays", table: "holiday_rule_holidays", group: "Company setup", where: via("holidayRuleId", "holiday_rules"), paged: false },
  { file: "pto_policies", table: "pto_policies", group: "Company setup", where: OWN },
  { file: "pto_policy_rules", table: "pto_policy_rules", group: "Company setup", where: via("ptoPolicyId", "pto_policies") },
  { file: "site_pto_policies", table: "site_pto_policies", group: "Company setup", where: via("siteId", "sites") },
  { file: "roles", table: "custom_roles", group: "Company setup", where: OWN },
  { file: "role_permissions", table: "role_permissions", group: "Company setup", where: via("customRoleId", "custom_roles") },
  { file: "time_clocks", table: "devices", group: "Company setup", where: OWN },

  { file: "employees", table: "employees", group: "People", where: OWN },
  { file: "users", table: "users", group: "People", where: `t.id IN (SELECT "userId" FROM employees WHERE "tenantId" = $1)`, omit: ["passwordHash"] },
  { file: "employee_badges", table: "employee_badges", group: "People", where: PERSON },
  { file: "employee_supervisors", table: "employee_supervisors", group: "People", where: PERSON },
  { file: "employee_pay_rates", table: "employee_pay_rates", group: "People", where: PERSON },
  { file: "employee_rule_set_history", table: "employee_ruleset_history", group: "People", where: PERSON },
  { file: "employee_site_access", table: "hr_site_access", group: "People", where: PERSON },
  { file: "documents", table: "documents", group: "People", where: PERSON },

  { file: "pay_periods", table: "pay_periods", group: "Time", where: OWN },
  { file: "timesheets", table: "timesheets", group: "Time", where: PERSON },
  { file: "punches", table: "punches", group: "Time", where: PERSON },
  { file: "scans", table: "scan_events", group: "Time", where: OWN },
  { file: "schedule", table: "schedule_days", group: "Time", where: OWN },
  { file: "work_segments", table: "work_segments", group: "Time", where: TIMESHEET },
  { file: "overtime_totals", table: "overtime_buckets", group: "Time", where: TIMESHEET },
  { file: "exceptions", table: "exceptions", group: "Time", where: TIMESHEET },
  { file: "meal_waivers", table: "meal_waivers", group: "Time", where: TIMESHEET },
  { file: "meal_premium_waivers", table: "meal_premium_waivers", group: "Time", where: TIMESHEET },
  { file: "timesheet_notes", table: "timesheet_notes", group: "Time", where: TIMESHEET },
  { file: "timesheet_day_reasons", table: "timesheet_day_reasons", group: "Time", where: TIMESHEET, paged: false },
  { file: "gate_refusals", table: "gate_refusals", group: "Time", where: OWN },
  { file: "payroll_runs", table: "payroll_runs", group: "Time", where: via("payPeriodId", "pay_periods") },

  { file: "leave_requests", table: "leave_requests", group: "Leave", where: PERSON },
  { file: "leave_balances", table: "leave_balances", group: "Leave", where: PERSON },
  { file: "leave_history", table: "leave_accrual_ledger", group: "Leave", where: PERSON },

  { file: "report_folders", table: "report_folders", group: "Reports", where: OWN },
  { file: "reports", table: "report_definitions", group: "Reports", where: OWN },
  { file: "report_schedules", table: "report_schedules", group: "Reports", where: via("reportId", "report_definitions") },
  { file: "report_shares", table: "report_shares", group: "Reports", where: via("reportId", "report_definitions") },
  { file: "report_runs", table: "report_runs", group: "Reports", where: via("reportId", "report_definitions") },

  { file: "change_history", table: "audit_logs", group: "History and connections", where: OWN },
  { file: "api_keys", table: "api_keys", group: "History and connections", where: OWN, omit: ["keyHash"] },
  { file: "webhooks", table: "webhook_endpoints", group: "History and connections", where: OWN, omit: ["keyCheck"] },
];

/** What is left out, for the note in the ZIP and the window. */
export const NOT_EXPORTED = [
  "Sign in secrets: passwords, sign in sessions, phone app tokens, password reset links, connected Google accounts, and the secret part of API keys and webhooks.",
  "CloudTime's own system logs: time clock health reports, sync and bridge jobs, the WMS roster queue, webhook delivery attempts, and which Live Attendance screens were open.",
];

/** Contact fields saved encrypted on the person, written out readable. */
function readableRow(table: string, row: Record<string, unknown>) {
  return table === "employees" ? readablePii(row, decryptPii) : row;
}

async function* tableCsv(tenantId: string, spec: ExportTable, page: number, counted: (n: number) => void): AsyncGenerator<string> {
  const omit = new Set(spec.omit ?? []);
  let columns: string[] | null = null;
  let after: string | null = null;
  let rows = 0;
  for (;;) {
    const paged = spec.paged !== false;
    const sql = paged
      ? `SELECT t.* FROM "${spec.table}" t WHERE ${spec.where}${after ? ` AND t.id > $2` : ""} ORDER BY t.id LIMIT ${page}`
      : `SELECT t.* FROM "${spec.table}" t WHERE ${spec.where}`;
    const batch: Record<string, unknown>[] = await (after ? db.$queryRawUnsafe<Record<string, unknown>[]>(sql, tenantId, after) : db.$queryRawUnsafe<Record<string, unknown>[]>(sql, tenantId));
    if (!columns) {
      columns = batch.length ? Object.keys(batch[0]).filter((c) => !omit.has(c)) : await tableColumns(spec.table, omit);
      yield csvLine(columns);
    }
    if (batch.length === 0) break;
    let out = "";
    for (const raw of batch) {
      const row = readableRow(spec.table, raw);
      out += csvLine(columns.map((c) => row[c]));
    }
    rows += batch.length;
    yield out;
    if (!paged || batch.length < page) break;
    after = String(batch[batch.length - 1].id);
  }
  counted(rows);
}

async function tableColumns(table: string, omit: Set<string>): Promise<string[]> {
  const cols = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`;
  return cols.map((c) => c.column_name).filter((c) => !omit.has(c));
}

async function* one(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const safeName = (s: string) => s.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 80) || "file";

export interface CompanyExportResult {
  tables: Record<string, number>;
  documents: number;
  photos: number;
  missingFiles: number;
}

/**
 * Writes the whole export into `zip`. Tables first, then the documents and
 * (when asked) the time clock photos, then the index and the note.
 */
export async function writeCompanyExport(
  tenantId: string,
  zip: ZipStream,
  opts: { photos: boolean; exportedAt: Date; /** Tests only. */ pageSize?: number },
): Promise<CompanyExportResult> {
  const page = Math.max(1, Math.floor(opts.pageSize ?? PAGE));
  const result: CompanyExportResult = { tables: {}, documents: 0, photos: 0, missingFiles: 0 };

  for (const spec of EXPORT_TABLES) {
    await zip.add(`data/${spec.file}.csv`, tableCsv(tenantId, spec, page, (n) => (result.tables[spec.file] = n)), opts.exportedAt);
  }

  const docs = await db.document.findMany({
    where: { employee: { tenantId } },
    select: { id: true, title: true, fileUrl: true, fileType: true, employee: { select: { employeeCode: true } } },
    orderBy: { uploadedAt: "asc" },
  });
  for (const d of docs) {
    const bytes = await createSignedUrl(d.fileUrl).then(fetchBytes, () => null);
    if (!bytes) {
      result.missingFiles++;
      continue;
    }
    const ext = (d.fileUrl.match(/\.[A-Za-z0-9]{1,6}$/)?.[0] ?? "").toLowerCase();
    await zip.add(`documents/${safeName(d.employee.employeeCode)}/${d.id} ${safeName(d.title)}${ext}`, one(bytes), opts.exportedAt);
    result.documents++;
  }

  if (opts.photos) {
    const people = await db.employee.findMany({ where: { tenantId }, select: { id: true, barcode: true, wmsId: true, employeeCode: true }, orderBy: { employeeCode: "asc" } });
    for (let i = 0; i < people.length; i += 200) {
      const chunk = people.slice(i, i + 200);
      const urls = await photoUrls(tenantId, chunk, { evenWhereOff: true });
      for (const p of chunk) {
        const url = urls.get(p.id);
        if (!url) continue;
        const bytes = await fetchBytes(url);
        if (!bytes) {
          result.missingFiles++;
          continue;
        }
        await zip.add(`photos/${safeName(p.employeeCode)}.jpg`, one(bytes), opts.exportedAt);
        result.photos++;
      }
    }
  }

  async function* index() {
    yield csvLine(["file", "table", "group", "rows"]);
    for (const s of EXPORT_TABLES) yield csvLine([`data/${s.file}.csv`, s.table, s.group, result.tables[s.file] ?? 0]);
  }
  await zip.add("data/_index.csv", index(), opts.exportedAt);

  const note = [
    "CloudTime company data export",
    "",
    `Exported ${opts.exportedAt.toISOString()} (UTC).`,
    "",
    "data/ holds one CSV file per table, UTF-8, comma separated, with a header row. data/_index.csv lists every file and its number of rows.",
    "Times are ISO 8601 in UTC. Ids link the files: employeeId in punches is the id in employees, and so on.",
    `documents/ holds ${result.documents} uploaded files, by employee code.`,
    opts.photos ? `photos/ holds ${result.photos} time clock photos, named by employee code.` : "Time clock photos were not included in this export.",
    result.missingFiles ? `${result.missingFiles} files could not be read from storage and are not included.` : "",
    "",
    "Not included:",
    ...NOT_EXPORTED.map((n) => `  ${n}`),
    "",
  ].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\r\n");
  await zip.add("About this export.txt", one(Buffer.from(note, "utf8")), opts.exportedAt);

  return result;
}
