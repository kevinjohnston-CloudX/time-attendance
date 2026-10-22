import { db } from "@/lib/db";
import type { DataSourceDefinition, ExecuteContext, ReportResult } from "./index";
import { sortRowsInMemory } from "../query-builder";
import { describeSpan } from "../period";
import { localMoment, peopleFor, PERSON_FIELDS, PERSON_FILTERS, personCells, reportSpan, textFilter, visible } from "../scope";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * The notes written on timesheets: the day each is about, what it says, who
 * wrote it and when. NovaTime's Timesheet Notes.
 */
const columns = [
  { id: "employeeName", label: "Employee", type: "string" as const, defaultVisible: true },
  { id: "employeeCode", label: "Badge ID", type: "string" as const, defaultVisible: true },
  { id: "department", label: "Department", type: "string" as const, defaultVisible: false },
  { id: "site", label: "Site", type: "string" as const, defaultVisible: false },
  { id: "date", label: "Date", type: "date" as const, defaultVisible: true },
  { id: "note", label: "Note", type: "string" as const, defaultVisible: true },
  { id: "addedBy", label: "Added by", type: "string" as const, defaultVisible: true },
  { id: "addedOn", label: "Added on", type: "string" as const, defaultVisible: true },
];

export const timesheetNotesSource: DataSourceDefinition = {
  id: "TIMESHEET_NOTES",
  label: "Timesheet notes",
  description: "The notes written on timesheets: the day, the note, who wrote it and when.",
  icon: "StickyNote",
  columns,
  filters: [...PERSON_FILTERS, { id: "note", label: "Note", type: "string", operators: ["contains"] }],
  groupableFields: ["employeeName", "department", "site", "addedBy"],
  fieldMap: PERSON_FIELDS,

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    const span = await reportSpan(config.dateRange, tenantId, ctx);
    const people = await peopleFor(config.filters, tenantId);
    const cols = visible(columns, config.columns);
    if (!span || people.length === 0) return { columns: cols, rows: [], totalRows: 0 };
    const byId = new Map(people.map((p) => [p.id, p]));

    const notes = await db.timesheetNote.findMany({
      where: {
        timesheet: { employeeId: { in: [...byId.keys()] } },
        noteDate: { gte: new Date(`${span.start}T00:00:00Z`), lte: new Date(`${span.end}T00:00:00Z`) },
      },
      select: { noteDate: true, note: true, createdByName: true, createdAt: true, timesheet: { select: { employeeId: true } } },
      orderBy: [{ noteDate: "asc" }, { createdAt: "asc" }],
    });

    let rows: Record<string, unknown>[] = notes.map((n) => {
      const p = byId.get(n.timesheet.employeeId)!;
      return {
        ...personCells(p),
        date: n.noteDate.toISOString().slice(0, 10),
        note: n.note,
        addedBy: n.createdByName ?? null,
        addedOn: localMoment(n.createdAt, p.timeZone),
      };
    });
    rows = textFilter(rows, config.filters, ["note"]);
    rows.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)) || String(a.date).localeCompare(String(b.date)));
    const sorted = sortRowsInMemory(rows, config.sortBy, {});
    const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
    return { columns: cols, rows: limited, totalRows: sorted.length, period: { start: span.start, end: span.end, label: describeSpan(span) } };
  },
};
