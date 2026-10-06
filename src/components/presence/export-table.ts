import type { PresencePerson, SiteDay } from "@/lib/presence/types";
import type { PersonDayView } from "@/lib/presence/movements";
import { fmtShift, fmtTime, readerLines, siteDate, statusLabel } from "./presence-meta";

/**
 * What Live Attendance exports, as plain tables, and the three ways a table
 * leaves the page: printed, as an Excel file, or as a CSV file.
 *
 * <p>Every export is built here from data the page already holds, so a file
 * always says the same as the screen it came from. Nothing in this file
 * fetches anything or decides who may see what: the board's own queries do
 * that, and the Export button is only drawn for roles allowed to take a copy.
 */

export interface ExportTable {
  /** What the file and the printed sheet are called: "In the building". */
  title: string;
  /** The building it is about. */
  site: string;
  /** One line under the title: "Tue, Oct 6, 2026 at 9:41 AM". */
  when: string;
  /** The file name without its extension. */
  fileStem: string;
  columns: string[];
  rows: string[][];
  /** What narrowed it, in words, for the printed sheet: "Department: Picking". */
  filters: string[];
  /** The noun for one row, for the counts: "person" or "scan". */
  unit: { one: string; many: string };
  /**
   * Printed with a tick box in front of each row and a sign off line at the
   * bottom: a list someone walks with, to account for every person on it.
   */
  rollCall?: boolean;
  /** Which columns the printed sheet keeps, by index, when it cannot fit them all. */
  printColumns?: number[];
  /** The column printed rows are grouped under, by index. */
  groupBy?: number;
  /** Something the reader must know about the rows, such as a day too busy to carry in full. */
  note?: string;
}

/* ── Who is in each list ─────────────────────────────────────────────────── */

export type PeopleSet = "inside" | "clocked" | "everyone";

export interface PeopleScope {
  departmentId: string;
  shiftId: string;
  /** For "clocked": people on a meal or a break are still on the time clock's books. */
  includeBreaks: boolean;
}

/**
 * The people in a list, the same way the board counts them: "inside" is the
 * building total on the board's first card, "clocked" is the time clock's
 * working count (a meal or a break only when asked for), "everyone" is every
 * person the board has today, whatever they are doing.
 */
export function selectPeople(people: PresencePerson[], set: PeopleSet, scope: PeopleScope): PresencePerson[] {
  return people.filter((p) => {
    if (scope.departmentId && p.departmentId !== scope.departmentId) return false;
    if (scope.shiftId && p.shiftId !== scope.shiftId) return false;
    if (set === "inside") return p.inside;
    if (set === "clocked") {
      const c = p.clock;
      if (!c || c.automatic) return false;
      return c.state === "WORK" || (scope.includeBreaks && (c.state === "MEAL" || c.state === "BREAK"));
    }
    return true;
  });
}

export type PeopleOrder = "name" | "department" | "code" | "arrived";

export const ORDER_LABEL: Record<PeopleOrder, string> = {
  name: "Name",
  department: "Department, then name",
  code: "Employee ID",
  arrived: "Time arrived, earliest first",
};

function sortPeople(people: PresencePerson[], order: PeopleOrder): PresencePerson[] {
  const byName = (a: PresencePerson, b: PresencePerson) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const sorted = [...people];
  if (order === "name") sorted.sort(byName);
  if (order === "department")
    sorted.sort((a, b) => (a.department ?? "￿").localeCompare(b.department ?? "￿", "en", { sensitivity: "base" }) || byName(a, b));
  if (order === "code") sorted.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, "en", { numeric: true }) || byName(a, b));
  if (order === "arrived") sorted.sort((a, b) => (a.firstInToday ?? "￿").localeCompare(b.firstInToday ?? "￿") || byName(a, b));
  return sorted;
}

/* ── Times ───────────────────────────────────────────────────────────────── */

/** A moment in the building's zone: "9:41 AM" today, "Oct 5, 10:02 PM" on an earlier day. */
export function whenIn(iso: string | null, tz: string, nowIso: string): string {
  if (!iso) return "";
  const t = fmtTime(iso, tz);
  if (siteDate(iso, tz) === siteDate(nowIso, tz)) return t;
  const d = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(iso));
  return `${d}, ${t}`;
}

/** "Tue, Oct 6, 2026 at 9:41 AM", for the line under a title. */
export function stampLine(iso: string, tz: string): string {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
  return `${d} at ${fmtTime(iso, tz)}`;
}

/** "2026-10-06 0941 AM", for a file name that sorts and never repeats within a minute. */
export function fileStamp(iso: string, tz: string): string {
  return `${siteDate(iso, tz)} ${fmtTime(iso, tz).replace(/[: ]/g, "")}`;
}

/* ── People lists ────────────────────────────────────────────────────────── */

const SET_TITLE: Record<PeopleSet, string> = {
  inside: "In the building",
  clocked: "Clocked in",
  everyone: "Everyone today",
};

export function peopleTable({
  people,
  set,
  scope,
  order,
  site,
  tz,
  generatedAt,
  hasGateData,
  filters,
}: {
  people: PresencePerson[];
  set: PeopleSet;
  scope: PeopleScope;
  order: PeopleOrder;
  site: string;
  tz: string;
  generatedAt: string;
  hasGateData: boolean;
  filters: string[];
}): ExportTable {
  const chosen = sortPeople(selectPeople(people, set, scope), order);
  const now = new Date(generatedAt).getTime();
  const columns = [
    "Name",
    "Employee ID",
    "Department",
    "Shift",
    "Status",
    "Since",
    "First in today",
    "Scheduled",
    ...(hasGateData ? ["Security gate"] : []),
    "Time clock",
    "Home site",
  ];
  const rows = chosen.map((p) => [
    p.name,
    p.employeeCode,
    p.department ?? "",
    p.shift ?? "",
    statusLabel(p),
    whenIn(p.since, tz, generatedAt),
    whenIn(p.firstInToday, tz, generatedAt),
    fmtShift(p.scheduledStart, p.scheduledEnd) ?? "",
    ...readerLines(p, tz, now, hasGateData).map((l) => l.title.replace(/^[^:]+: /, "")),
    p.homeSite ?? site,
  ]);
  const title = set === "inside" && !hasGateData ? "On the clock" : SET_TITLE[set];
  return {
    title,
    site,
    when: stampLine(generatedAt, tz),
    fileStem: `${title} ${site} ${fileStamp(generatedAt, tz)}`,
    columns,
    rows,
    filters,
    unit: { one: "person", many: "people" },
    // A list of who is here now is walked with a pen; everyone today is not.
    rollCall: set !== "everyone",
    // Name, ID, department, status, since: what a person with a clipboard reads.
    printColumns: [0, 1, 2, 4, 5],
    groupBy: order === "department" ? 2 : undefined,
  };
}

/* ── A day: movements ──────────────────────────────────────────────────── */

const ACTIVITY: Record<string, string> = {
  INSIDE: "Inside the building",
  WORK: "On the clock",
  MEAL: "Meal",
  BREAK: "Break",
  EXIT_ONLY: "Left, never scanned in",
};

/** One line per stretch of the day per person, the Movements view as rows. */
export function movementsLines(views: PersonDayView[], data: Pick<SiteDay, "site" | "day" | "today">): string[][] {
  const tz = data.site.timezone;
  const time = (ms: number | null) => (ms === null ? "" : fmtTime(new Date(ms).toISOString(), tz));
  const header = ["Name", "Employee ID", "Department", "Home site", "Scheduled", "Reader", "Activity", "From", "To", "Minutes", "Notes"];
  const lines: string[][] = [header];
  for (const v of views) {
    const base = [v.person.name, v.person.employeeCode, v.person.department ?? "", v.person.homeSite ?? data.site.name, fmtShift(v.person.scheduledStart, v.person.scheduledEnd) ?? ""];
    if (v.lines.length === 0) {
      lines.push([...base, "", v.person.onLeave ? "On leave" : "Not seen", "", "", "", ""]);
      continue;
    }
    for (const l of v.lines) {
      lines.push([
        ...base,
        l.reader === "gate" ? "Security gate" : "Time clock",
        ACTIVITY[l.kind] ?? l.kind,
        l.carried ? "Since the day before" : time(l.start),
        l.end === null ? (data.day === data.today ? "Still going" : "Never scanned out") : time(l.end),
        l.kind === "EXIT_ONLY" ? "" : String(l.minutes),
        l.closedBySystem ? "Closed by the system" : "",
      ]);
    }
  }
  return lines;
}

/** "Today", "Yesterday" or "Mon, Oct 5", with the year only when it is not this one. */
export function dayWords(day: string, today: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const long = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
  if (day === today) return `Today, ${long}`;
  return long;
}

/** A table from rows of text whose first row is the heading. */
export function linesTable(lines: string[][], meta: Omit<ExportTable, "columns" | "rows">): ExportTable {
  const [columns = [], ...rows] = lines;
  return { ...meta, columns, rows };
}

/* ── Writers ─────────────────────────────────────────────────────────────── */

/**
 * A cell as CSV wants it. A leading = + - or @ would be read by Excel as a
 * formula, so it is made plain text first: names and notes come from people.
 */
export function csvCell(v: string): string {
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** With a byte order mark, so Excel reads accented names as they are. */
export function toCsv(t: ExportTable): string {
  return "﻿" + [t.columns, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The printed sheet. Plain black on white whatever theme the screen is in,
 * the header row repeated on every page, and for a roll call a tick box per
 * person and a line to sign at the end.
 */
export function printHtml(t: ExportTable): string {
  const cols = t.printColumns ?? t.columns.map((_, i) => i);
  const keep = cols.filter((i) => i !== t.groupBy);
  const span = keep.length + (t.rollCall ? 1 : 0);
  const count = `${t.rows.length.toLocaleString("en-US")} ${t.rows.length === 1 ? t.unit.one : t.unit.many}`;

  const row = (r: string[]) =>
    `<tr>${t.rollCall ? '<td class="tick"><span></span></td>' : ""}${keep.map((i) => `<td>${esc(r[i] ?? "")}</td>`).join("")}</tr>`;

  let body = "";
  if (t.groupBy !== undefined) {
    const groups = new Map<string, string[][]>();
    for (const r of t.rows) {
      const k = r[t.groupBy] || "No department";
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const [name, rs] of groups) {
      body += `<tr class="group"><td colspan="${span}">${esc(name)} <span>${rs.length}</span></td></tr>${rs.map(row).join("")}`;
    }
  } else {
    body = t.rows.map(row).join("");
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`${t.title}, ${t.site}`)}</title>
<style>
  @page { size: letter; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #111; margin-bottom: 10px; }
  h1 { margin: 0 0 2px; font-size: 20px; line-height: 1.2; }
  .sub { color: #444; }
  .total { text-align: right; white-space: nowrap; }
  .total b { display: block; font-size: 22px; line-height: 1.1; }
  .filters { margin: 0 0 8px; color: #444; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #444; border-bottom: 1px solid #111; padding: 5px 6px; }
  td { padding: 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  tr { break-inside: avoid; }
  td.tick, th.tick { width: 26px; }
  td.tick span { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #111; border-radius: 2px; }
  tr.group td { padding-top: 12px; font-weight: 700; border-bottom: 1px solid #111; }
  tr.group td span { font-weight: 400; color: #444; margin-left: 6px; }
  .sign { display: flex; gap: 28px; margin-top: 26px; break-inside: avoid; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; color: #444; }
  .empty { padding: 24px 6px; color: #444; }
</style></head><body>
<header>
  <div><h1>${esc(t.title)}</h1><div class="sub">${esc(t.site)} · ${esc(t.when)}</div></div>
  <div class="total"><b>${t.rows.length.toLocaleString("en-US")}</b>${esc(t.rows.length === 1 ? t.unit.one : t.unit.many)}</div>
</header>
${t.filters.length ? `<p class="filters">${esc(t.filters.join(" · "))}</p>` : ""}
${t.note ? `<p class="filters"><b>${esc(t.note)}</b></p>` : ""}
<table>
  <thead><tr>${t.rollCall ? '<th class="tick"></th>' : ""}${keep.map((i) => `<th>${esc(t.columns[i])}</th>`).join("")}</tr></thead>
  <tbody>${body || `<tr><td class="empty" colspan="${span}">No one on this list.</td></tr>`}</tbody>
</table>
${t.rollCall ? `<div class="sign"><div>Checked by</div><div>Time</div><div>Accounted for &nbsp;____ of ${esc(count)}</div></div>` : ""}
</body></html>`;
}

/** An Excel file, made in the browser. The library loads only when somebody asks for one. */
export async function toXlsx(t: ExportTable): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  book.creator = "CloudTime";
  book.created = new Date();
  const sheet = book.addWorksheet(t.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = t.columns.map((c, i) => ({
    header: c,
    key: String(i),
    width: Math.min(40, Math.max(c.length, ...t.rows.slice(0, 200).map((r) => (r[i] ?? "").length)) + 2),
  }));
  const head = sheet.getRow(1);
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
  for (const r of t.rows) sheet.addRow(r);
  if (t.rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: t.rows.length + 1, column: t.columns.length } };
  const buf = await book.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Saves a file through the browser. */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, "-");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Prints a sheet from a frame the viewer never sees, so the page itself is
 * not what prints and no new window can be blocked. The frame goes once the
 * print dialog closes.
 */
export function printSheet(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", done, { once: true });
  // Let the frame lay its table out before the dialog takes its picture.
  setTimeout(() => {
    win.focus();
    win.print();
    // Some browsers never fire afterprint for a frame; tidy up regardless.
    setTimeout(done, 60_000);
  }, 50);
}
