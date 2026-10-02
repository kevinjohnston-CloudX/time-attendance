import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, sortRowsInMemory, type FieldMap } from "../query-builder";
import { periodDayRange } from "@/lib/pay-period-days";
import type { ReportConfig } from "@/lib/validators/report.schema";

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "timesheet.employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "timesheet.employee.wmsId",           type: "string" },
  department:    { prismaPath: "timesheet.employee.department.name",  type: "string" },
  departmentId:  { prismaPath: "timesheet.employee.departmentId",     type: "string" },
  site:          { prismaPath: "timesheet.employee.site.name",        type: "string" },
  siteId:        { prismaPath: "timesheet.employee.siteId",           type: "string" },
  payType:       { prismaPath: "timesheet.employee.payType",          type: "string" },
  segmentDate:   { prismaPath: "segmentDate",                         type: "date" },
};

export const dailyHoursSource: DataSourceDefinition = {
  id: "DAILY_HOURS",
  label: "Daily hours",
  description: "One row per employee per day showing REG, OT, and DT hours alongside first clock-in and last clock-out. Time off and holiday hours count as Regular, as they do on the timecard.",
  icon: "CalendarClock",
  columns: [
    { id: "employeeName",    label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",    label: "Badge ID",       type: "string",  defaultVisible: false },
    { id: "department",      label: "Department",     type: "string",  defaultVisible: true },
    { id: "site",            label: "Site",           type: "string",  defaultVisible: false },
    { id: "date",            label: "Date",           type: "date",    defaultVisible: true },
    { id: "clockIn",         label: "Clock in",       type: "string",  defaultVisible: true },
    { id: "clockOut",        label: "Clock out",      type: "string",  defaultVisible: true },
    { id: "regMinutes",      label: "Regular",      type: "number",  defaultVisible: true },
    { id: "otMinutes",       label: "Overtime",       type: "number",  defaultVisible: true },
    { id: "dtMinutes",       label: "Double time",       type: "number",  defaultVisible: true },
    { id: "totalMinutes",    label: "Total",    type: "number",  defaultVisible: true },
    { id: "payType",         label: "Pay type",       type: "string",  defaultVisible: false },
    { id: "payCodes",        label: "Pay codes",      type: "string",  defaultVisible: false },
    { id: "reasonCode",      label: "Reason code",    type: "string",  defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "employeeCode", label: "Badge ID",       type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department",     type: "string", operators: ["eq", "in"] },
    { id: "siteId",       label: "Site",           type: "string", operators: ["eq", "in"] },
    { id: "payType",      label: "Pay type",       type: "string", operators: ["eq"],
      options: [
        { value: "HOURLY", label: "Hourly" },
        { value: "SALARY", label: "Salary" },
      ] },
  ],
  groupableFields: ["department", "site"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const dateFilter = resolveDateFilter(config.dateRange);
    const filterWhere = buildWhereClause(config.filters, fieldMap);

    const dateTimesheetFilter = (dateFilter.timesheet as Record<string, unknown>) ?? {};
    const employeeFilter =
      ((filterWhere.timesheet as Record<string, unknown>)?.employee as Record<string, unknown>) ?? {};
    const { timesheet: _ft, ...rootFilterWhere } = filterWhere as Record<string, unknown>;

    const where = {
      ...(dateFilter.segmentDate !== undefined ? { segmentDate: dateFilter.segmentDate } : {}),
      ...rootFilterWhere,
      timesheet: {
        ...dateTimesheetFilter,
        employee: {
          tenantId,
          ...employeeFilter,
        },
      },
    } as Prisma.WorkSegmentWhereInput;

    const segments = await db.workSegment.findMany({
      where,
      include: {
        payCode: { select: { code: true, label: true } },
        timesheet: {
          include: {
            employee: { include: { user: true, department: true, site: true } },
            dayReasons: { include: { reasonCode: { select: { code: true, label: true } } } },
          },
        },
      },
      orderBy: [{ segmentDate: "asc" }, { startTime: "asc" }],
      take: config.limit ? config.limit * 25 : undefined, // over-fetch since we collapse to day rows
    });

    // Group segments by employee + date.
    // Pass 1: build day entries and count hours and pay codes from non-zero segments.
    // Pass 2: let a 0-duration absent-day marker's pay code stand for its day.
    //
    // The hours are counted the way the timecard counts them (timecard-viewer's
    // day row), so the two agree: time off, holiday and meal premium hours sit
    // under Regular, the pay code says which they are, and Total is the paid
    // hours, so unpaid time off is in Regular but not in Total.
    type DayKey = string; // "employeeId|YYYY-MM-DD"
    const dayMap = new Map<DayKey, DayRow>();

    // Pass 1: create entries and count hours (non-zero segments only)
    for (const seg of segments) {
      if (seg.durationMinutes === 0) continue;

      const dateStr = seg.segmentDate.toISOString().slice(0, 10);
      const key: DayKey = `${seg.timesheet.employeeId}|${dateStr}`;

      if (!dayMap.has(key)) {
        const dayReason = seg.timesheet.dayReasons.find(
          (dr) => dr.segmentDate.toISOString().slice(0, 10) === dateStr
        );
        dayMap.set(key, {
          employeeId: seg.timesheet.employeeId,
          timezone: seg.timesheet.employee.site.timezone,
          isSalary: seg.timesheet.employee.payType === "SALARY",
          employeeName: seg.timesheet.employee.user?.name ?? seg.timesheet.employee.employeeCode,
          employeeCode: seg.timesheet.employee.wmsId ?? seg.timesheet.employee.employeeCode,
          department: seg.timesheet.employee.department.name,
          site: seg.timesheet.employee.site.name,
          date: dateStr,
          clockIn: null,
          clockOut: null,
          regMinutes: 0,
          otMinutes: 0,
          dtMinutes: 0,
          paidMinutes: 0,
          payType: seg.timesheet.employee.payType === "SALARY" ? "Salary" : "Hourly",
          payCodeSet: new Set(),
          reasonCode: dayReason
            ? `${dayReason.reasonCode.code} (${dayReason.reasonCode.label})`
            : null,
        });
      }

      const day = dayMap.get(key)!;

      // An override to REG/OT/DT only tags the line; the engine's bucket decides the column.
      const bucket =
        seg.payBucketOverride && !["REG", "OT", "DT"].includes(seg.payBucketOverride)
          ? seg.payBucketOverride
          : seg.payBucket;
      const column =
        seg.segmentType === "HOLIDAY" || seg.segmentType === "LEAVE" || seg.segmentType === "MEAL_PREMIUM"
          ? "REG"
          : bucket;
      if (column === "REG")      day.regMinutes += seg.durationMinutes;
      else if (column === "OT")  day.otMinutes  += seg.durationMinutes;
      else if (column === "DT")  day.dtMinutes  += seg.durationMinutes;
      if (seg.isPaid) day.paidMinutes += seg.durationMinutes;

      if (seg.payCode && seg.segmentType !== "MEAL") {
        day.payCodeSet.add(`${seg.payCode.label} (${seg.payCode.code})`);
      }
    }

    // Days with no hours still get a line when the timecard has something to
    // say about them: a clock in that was never clocked out, or a scheduled
    // day nobody came in. Added before pass 2, so a code HR picked for the day
    // shows on it.
    await addDaysWithoutHours(dayMap, config.dateRange, tenantId, employeeFilter);

    // Pass 2: apply pay codes from 0-duration absent-day markers.
    // These markers are written by the timecard CODE dropdown (setAbsentDayPayCode) and
    // are the authoritative source for what the timecard shows on absent/leave days.
    // When a marker exists for a day, it replaces whatever pay codes were collected from
    // the underlying LEAVE segments (which may be stale from a policy sync or recalculate).
    for (const seg of segments) {
      if (seg.durationMinutes !== 0 || !seg.payCode) continue;
      const key: DayKey = `${seg.timesheet.employeeId}|${seg.segmentDate.toISOString().slice(0, 10)}`;
      const day = dayMap.get(key);
      if (day) {
        day.payCodeSet.clear();
        day.payCodeSet.add(`${seg.payCode.label} (${seg.payCode.code})`);
      }
    }

    await fillClockTimes(dayMap);

    const rows = Array.from(dayMap.values()).map((day) => ({
      employeeName:  day.employeeName,
      employeeCode:  day.employeeCode,
      department:    day.department,
      site:          day.site,
      date:          day.date,
      clockIn:       day.clockIn ? siteClock(day.clockIn, day.timezone) : null,
      clockOut:      day.clockOut ? siteClock(day.clockOut, day.timezone) : null,
      regMinutes:    day.regMinutes,
      otMinutes:     day.otMinutes,
      dtMinutes:     day.dtMinutes,
      totalMinutes:  day.paidMinutes,
      payType:       day.payType,
      payCodes:      day.payCodeSet.size > 0 ? Array.from(day.payCodeSet).join(", ") : null,
      reasonCode:    day.reasonCode,
    }));

    // By date and then name unless the report says otherwise. Every column is
    // worked out here rather than read from one table, so the sort is too.
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));
    const sortedRows = sortRowsInMemory(rows, config.sortBy, {});

    // Apply row limit after collapsing
    const limitedRows = config.limit ? sortedRows.slice(0, config.limit) : sortedRows;

    const colById = Object.fromEntries(dailyHoursSource.columns.map((c) => [c.id, c]));
    const visibleColumns = config.columns.map((id) => colById[id]).filter(Boolean);

    return {
      columns: visibleColumns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows: limitedRows,
      totalRows: limitedRows.length,
    };
  },
};

/** One employee's day, while the report is being put together. */
type DayRow = {
  employeeId: string;
  timezone: string;
  isSalary: boolean;
  employeeName: string;
  employeeCode: string;
  department: string;
  site: string;
  date: string;
  clockIn: Date | null;
  clockOut: Date | null;
  regMinutes: number;
  otMinutes: number;
  dtMinutes: number;
  paidMinutes: number;
  payType: string;
  payCodeSet: Set<string>;
  reasonCode: string | null;
};

/**
 * The punches the clock columns are read from: the ones the hours are built
 * from, current and approved. That leaves out the system's automatic clock
 * out, which closes a shift nobody clocked out of so the next day can start;
 * it is not a time anyone left and its hours are not paid, so a missed clock
 * out shows as no clock out. It also leaves out an edit waiting for approval,
 * which the hours and the missed punch on the timecard do not count either.
 */
const CLOCK_PUNCH_WHERE = {
  correctedById: null,
  isRejected: false,
  isApproved: true,
  punchType: { in: ["CLOCK_IN", "CLOCK_OUT"] },
} satisfies Prisma.PunchWhereInput;

const nextDayStr = (day: string, n = 1) => new Date(Date.parse(day + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The days the report covers, as "yyyy-MM-dd", and for a pay period the
 * period itself, which also limits who is in it to that period's pay group.
 */
async function reportDays(
  dateRange: ReportConfig["dateRange"],
  tenantId: string,
): Promise<{ firstDay: string; lastDay: string; payPeriodId?: string } | null> {
  if (dateRange.type === "payPeriod") {
    const period = await db.payPeriod.findFirst({
      where: { id: dateRange.payPeriodId, tenantId },
      select: { startDate: true, endDate: true, ruleSet: { select: { payFrequency: true } }, tenant: { select: { payFrequency: true } } },
    });
    if (!period) return null;
    return { ...periodDayRange(period, period.ruleSet?.payFrequency ?? period.tenant.payFrequency), payPeriodId: dateRange.payPeriodId };
  }
  const span = resolveDateFilter(dateRange).segmentDate as { gte: Date; lte: Date } | undefined;
  if (!span) return null;
  return { firstDay: span.gte.toISOString().slice(0, 10), lastDay: span.lte.toISOString().slice(0, 10) };
}

/**
 * The days with no hours that the timecard still shows: a missed clock out,
 * where the clock in is all there is, and an absence, a day the person's shift
 * has them working with nothing recorded. An absence is a day the timecard has
 * raised an Absent exception for, so the report and the timecard agree on
 * which days count. Both come out with no hours; the clock columns are filled
 * in later, so an absence has neither and a missed punch has only the clock in.
 */
async function addDaysWithoutHours(
  dayMap: Map<string, DayRow>,
  dateRange: ReportConfig["dateRange"],
  tenantId: string,
  employeeFilter: Record<string, unknown>,
) {
  const days = await reportDays(dateRange, tenantId);
  if (!days) return;

  const employees = await db.employee.findMany({
    where: {
      tenantId,
      ...employeeFilter,
      ...(days.payPeriodId ? { timesheets: { some: { payPeriodId: days.payPeriodId } } } : {}),
    } as Prisma.EmployeeWhereInput,
    select: {
      id: true, wmsId: true, employeeCode: true, payType: true,
      user: { select: { name: true } },
      department: { select: { name: true } },
      site: { select: { name: true, timezone: true } },
    },
  });
  if (employees.length === 0) return;
  const byId = new Map(employees.map((e) => [e.id, e]));

  const found = new Map<string, { employeeId: string; date: string }>();
  const add = (employeeId: string, date: string) => {
    const key = `${employeeId}|${date}`;
    if (date >= days.firstDay && date <= days.lastDay && !dayMap.has(key)) found.set(key, { employeeId, date });
  };

  // Clock ins, by the day they fall on at the site. Salaried people have no clock times.
  const clockIns = await db.punch.findMany({
    where: {
      ...CLOCK_PUNCH_WHERE,
      punchType: "CLOCK_IN",
      employeeId: { in: employees.filter((e) => e.payType !== "SALARY").map((e) => e.id) },
      roundedTime: { gte: new Date(nextDayStr(days.firstDay, -1) + "T00:00:00Z"), lt: new Date(nextDayStr(days.lastDay, 2) + "T00:00:00Z") },
    },
    select: { employeeId: true, roundedTime: true },
  });
  for (const p of clockIns) add(p.employeeId, siteDay(p.roundedTime, byId.get(p.employeeId)!.site.timezone));

  // Absences. They are stamped at noon UTC on their day, so the UTC date is the day.
  const absences = await db.exception.findMany({
    where: {
      exceptionType: "ABSENT",
      occurredAt: { gte: new Date(days.firstDay + "T00:00:00Z"), lt: new Date(nextDayStr(days.lastDay) + "T00:00:00Z") },
      timesheet: { employeeId: { in: employees.map((e) => e.id) }, ...(days.payPeriodId ? { payPeriodId: days.payPeriodId } : {}) },
    },
    select: { occurredAt: true, timesheet: { select: { employeeId: true } } },
  });
  for (const a of absences) add(a.timesheet.employeeId, a.occurredAt.toISOString().slice(0, 10));

  if (found.size === 0) return;
  const reasons = await db.timesheetDayReason.findMany({
    where: {
      timesheet: { employeeId: { in: [...new Set([...found.values()].map((f) => f.employeeId))] } },
      segmentDate: { gte: new Date(days.firstDay + "T00:00:00Z"), lte: new Date(days.lastDay + "T00:00:00Z") },
    },
    select: { segmentDate: true, timesheet: { select: { employeeId: true } }, reasonCode: { select: { code: true, label: true } } },
  });
  const reasonByKey = new Map(reasons.map((r) => [`${r.timesheet.employeeId}|${r.segmentDate.toISOString().slice(0, 10)}`, `${r.reasonCode.code} (${r.reasonCode.label})`]));

  for (const [key, { employeeId, date }] of found) {
    const e = byId.get(employeeId)!;
    dayMap.set(key, {
      employeeId,
      timezone: e.site.timezone,
      isSalary: e.payType === "SALARY",
      employeeName: e.user?.name ?? e.employeeCode,
      employeeCode: e.wmsId ?? e.employeeCode,
      department: e.department.name,
      site: e.site.name,
      date,
      clockIn: null,
      clockOut: null,
      regMinutes: 0,
      otMinutes: 0,
      dtMinutes: 0,
      paidMinutes: 0,
      payType: e.payType === "SALARY" ? "Salary" : "Hourly",
      payCodeSet: new Set(),
      reasonCode: reasonByKey.get(key) ?? null,
    });
  }
}

/** A time on the site's clock, the way the timecard shows it: "7:58 AM". */
function siteClock(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(instant);
}

/** The calendar day an instant falls on at the site, as YYYY-MM-DD. */
function siteDay(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/**
 * Clock in and clock out from the punches, as the timecard shows them: the
 * day's first clock in and the clock out that ends its last shift (on the next
 * day for an overnight shift), at their rounded times. A shift with no clock
 * out has none, so a missed punch reads as a clock in and an empty clock out.
 * They used to come from
 * the hour segments, which a meal deduction can trim, and were written on the
 * server's clock rather than the site's, so California read three hours late.
 * Salaried days have no clock times, as before.
 */
async function fillClockTimes(dayMap: Map<string, DayRow>) {
  const days = [...dayMap.values()].filter((d) => !d.isSalary);
  if (days.length === 0) return;
  const dates = days.map((d) => d.date).sort();
  const from = new Date(`${dates[0]}T00:00:00.000Z`);
  const to = new Date(`${dates[dates.length - 1]}T00:00:00.000Z`);
  // A day either side covers every site's offset and an overnight clock out.
  from.setUTCDate(from.getUTCDate() - 1);
  to.setUTCDate(to.getUTCDate() + 2);

  const punches = await db.punch.findMany({
    where: {
      ...CLOCK_PUNCH_WHERE,
      employeeId: { in: [...new Set(days.map((d) => d.employeeId))] },
      roundedTime: { gte: from, lt: to },
    },
    select: { employeeId: true, punchType: true, roundedTime: true },
    orderBy: { roundedTime: "asc" },
  });
  const byEmployee = new Map<string, typeof punches>();
  for (const p of punches) {
    const list = byEmployee.get(p.employeeId) ?? [];
    list.push(p);
    byEmployee.set(p.employeeId, list);
  }

  for (const day of days) {
    const list = byEmployee.get(day.employeeId) ?? [];
    const ins = list.filter((p) => p.punchType === "CLOCK_IN" && siteDay(p.roundedTime, day.timezone) === day.date);
    if (ins.length === 0) continue;
    const lastIn = ins[ins.length - 1].roundedTime;
    day.clockIn = ins[0].roundedTime;
    // The punch after the last clock in closes the shift only if it is a clock
    // out; another clock in means the clock out was missed, and the next clock
    // out on file belongs to a later shift.
    const next = list.find((p) => p.roundedTime > lastIn);
    day.clockOut = next?.punchType === "CLOCK_OUT" ? next.roundedTime : null;
  }
}

function resolveDateFilter(dateRange: ReportConfig["dateRange"]): Record<string, unknown> {
  switch (dateRange.type) {
    case "payPeriod":
      return { timesheet: { payPeriodId: dateRange.payPeriodId } };
    case "custom":
      return {
        segmentDate: {
          gte: new Date(`${dateRange.startDate}T00:00:00.000Z`),
          lte: new Date(`${dateRange.endDate}T23:59:59.999Z`),
        },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - dateRange.relativeDays);
      start.setUTCHours(0, 0, 0, 0);
      return { segmentDate: { gte: start, lte: now } };
    }
    case "today": {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date();
      end.setUTCHours(23, 59, 59, 999);
      return { segmentDate: { gte: start, lte: end } };
    }
    case "yesterday": {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 1);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date();
      end.setUTCDate(end.getUTCDate() - 1);
      end.setUTCHours(23, 59, 59, 999);
      return { segmentDate: { gte: start, lte: end } };
    }
  }
}
