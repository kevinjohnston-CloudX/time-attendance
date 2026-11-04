import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { decryptPii } from "@/lib/crypto/pii";
import { readablePii } from "./data-protection";
import { personTimeZone } from "@/lib/utils/person-time-zone";

/**
 * Everything CloudTime holds about one person, for a data access request
 * (GDPR Article 15) or a portability request (Article 20).
 *
 * <p>Server only. The caller has already checked the permission and that the
 * person is in reach; every query here is keyed by that one person, and the
 * tables that carry a company are held to it as well, so a stray id can never
 * reach another company's rows.
 *
 * <p>The result is one Excel workbook with a sheet per kind of record, so HR
 * can open it and hand it over as it is, and a program can read it back.
 * Times are on the person's own clock, 12 hour with AM or PM, as everywhere
 * else in CloudTime. Read only: nothing here writes.
 */

export type Cell = string | number | null;

export interface PersonSection {
  /** Sheet name and the label in the export window. At most 31 characters. */
  title: string;
  /** One line under the title in the window, saying what the sheet holds. */
  description: string;
  columns: string[];
  rows: Cell[][];
}

export interface PersonExport {
  name: string;
  employeeCode: string;
  timeZone: string;
  sections: PersonSection[];
  /** The time clock photo, when there is one and it could be fetched. */
  photo: { bytes: Buffer; extension: "jpeg" | "png" } | null;
}

/** "PAYROLL_APPROVED" as "Payroll approved". */
export function humanize(value: string | null | undefined): string | null {
  if (!value) return null;
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An instant on the person's clock: "Oct 14, 2026, 7:02 AM". */
export function formatInstant(at: Date | null | undefined, timeZone: string): string | null {
  if (!at) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

/** A calendar date stored at midnight UTC: "Oct 14, 2026", never shifted a day by the time zone. */
export function formatDay(at: Date | null | undefined): string | null {
  if (!at) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(at);
}

/** Minutes as hours with two decimals, the way timecards show them. */
function hours(minutes: number | null | undefined): number | null {
  return minutes == null ? null : Math.round((minutes / 60) * 100) / 100;
}

function money(value: { toString(): string } | null | undefined): number | null {
  return value == null ? null : Number(value.toString());
}

function yesNo(value: boolean | null | undefined): string | null {
  return value == null ? null : value ? "Yes" : "No";
}

/**
 * Collects the person's records. `employeeId` must already be known to be in
 * `tenantId` and in the caller's reach; this function checks the company
 * again and returns null when the person is not there.
 */
export async function collectPersonData(tenantId: string, employeeId: string): Promise<Omit<PersonExport, "photo"> | null> {
  const emp = await db.employee.findFirst({
    where: { id: employeeId, tenantId },
    include: {
      user: { select: { id: true, name: true, email: true, workEmail: true, createdAt: true, passwordChangedAt: true } },
      site: { select: { name: true, timezone: true } },
      department: { select: { name: true } },
      jobTitleRef: { select: { name: true } },
      agencyRef: { select: { description: true } },
      supervisor: { select: { user: { select: { name: true } } } },
      customRole: { select: { name: true } },
      shift: { select: { name: true } },
    },
  });
  if (!emp) return null;

  // Encrypted and imported (stored as typed) values alike; see readablePii.
  const person = readablePii(emp, decryptPii);
  const tz = personTimeZone(emp);
  const at = (d: Date | null | undefined) => formatInstant(d, tz);

  const [
    badges,
    payRates,
    punches,
    scans,
    timesheets,
    leaveRequests,
    leaveBalances,
    ledger,
    schedule,
    refusals,
    documents,
    accounts,
  ] = await Promise.all([
    db.employeeBadge.findMany({ where: { employeeId }, orderBy: { createdAt: "asc" } }),
    db.employeePayRate.findMany({ where: { employeeId }, orderBy: { effectiveDate: "asc" } }),
    db.punch.findMany({
      where: { employeeId },
      orderBy: { punchTime: "asc" },
      include: { payCode: { select: { label: true } } },
    }),
    db.scanEvent.findMany({ where: { employeeId, tenantId }, orderBy: { scanTime: "asc" } }),
    db.timesheet.findMany({
      where: { employeeId },
      orderBy: { payPeriod: { startDate: "asc" } },
      include: {
        payPeriod: { select: { startDate: true, endDate: true } },
        exceptions: { orderBy: { occurredAt: "asc" } },
        notes: { orderBy: { noteDate: "asc" } },
      },
    }),
    db.leaveRequest.findMany({
      where: { employeeId },
      orderBy: { startDate: "asc" },
      include: { leaveType: { select: { name: true } } },
    }),
    db.leaveBalance.findMany({
      where: { employeeId },
      orderBy: [{ accrualYear: "asc" }],
      include: { leaveType: { select: { name: true } } },
    }),
    db.leaveAccrualLedger.findMany({
      where: { employeeId },
      orderBy: { createdAt: "asc" },
      include: { leaveType: { select: { name: true } } },
    }),
    db.scheduleDay.findMany({ where: { employeeId, tenantId }, orderBy: { workDate: "asc" } }),
    db.gateRefusal.findMany({ where: { employeeId, tenantId }, orderBy: { firstAt: "asc" }, include: { site: { select: { name: true } } } }),
    db.document.findMany({ where: { employeeId }, orderBy: { uploadedAt: "asc" } }),
    db.account.findMany({ where: { userId: emp.userId }, select: { provider: true } }),
  ]);

  // Audit entries about the person, their punches, timesheets and leave, and
  // the ones they made themselves. Ids are this person's only.
  const entityIds = [
    employeeId,
    emp.userId,
    ...punches.map((p) => p.id),
    ...timesheets.map((t) => t.id),
    ...leaveRequests.map((l) => l.id),
  ];
  const audits = await db.auditLog.findMany({
    where: { tenantId, OR: [{ entityId: { in: entityIds } }, { actorId: employeeId }] },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, action: true, entityType: true, actorId: true, changes: true },
  });

  const exceptions = timesheets.flatMap((t) => t.exceptions.map((e) => ({ ...e, period: t.payPeriod })));
  const notes = timesheets.flatMap((t) => t.notes);

  const profile: [string, Cell][] = [
    ["Name", emp.user.name],
    ["Work email", emp.user.workEmail],
    ["Personal email", emp.user.email],
    ["Employee code", emp.employeeCode],
    ["Badge number", emp.wmsId],
    ["Badge barcode", emp.barcode],
    ["Name on the time clocks", emp.wmsName],
    ["Site", emp.site.name],
    ["Department", emp.department.name],
    ["Job title", emp.jobTitleRef?.name ?? emp.jobTitle],
    ["Role", emp.customRole?.name ?? humanize(emp.role)],
    ["Supervisor", emp.supervisor?.user.name ?? null],
    ["Agency", emp.agencyRef?.description ?? null],
    ["Shift", emp.shift?.name ?? null],
    ["Active", yesNo(emp.isActive)],
    ["On leave", yesNo(emp.onLeave)],
    ["May punch from the web", yesNo(emp.webPunchEnabled)],
    ["Hire date", formatDay(emp.hireDate)],
    ["Adjusted hire date", formatDay(emp.adjustedHireDate)],
    ["Orientation date", formatDay(emp.orientationDate)],
    ["Title change date", formatDay(emp.titleChangeDate)],
    ["Termination date", formatDay(emp.terminatedAt)],
    ["Termination reason", emp.terminationReason],
    ["Date of birth", formatDay(emp.dateOfBirth)],
    ["Gender", person.gender],
    ["Marital status", person.maritalStatus],
    ["Phone", person.phone],
    ["Second phone", person.phone2],
    ["Address", person.address1],
    ["Address line 2", person.address2],
    ["City", person.city],
    ["State or region", person.state],
    ["Postal code", person.zipCode],
    ["Country", person.country],
    ["Emergency contact", person.emergencyContact],
    ["Emergency contact phone", person.emergencyPhone],
    ["Emergency contact relationship", person.emergencyRelationship],
    ["Preferred language", emp.preferredLanguage],
    ["Time zone", tz],
    ["Pay type", humanize(emp.payType)],
    ["Pay rate", money(emp.payRate)],
    ["Charge rate", money(emp.chargeRate)],
    ["Holiday rate", money(emp.holidayRate)],
    ["Overtime rate", money(emp.overtimeRate)],
    ["Signs in with", accounts.length ? accounts.map((a) => humanize(a.provider)).join(", ") + (emp.user.passwordChangedAt ? ", password" : "") : "Password"],
    ["Password last set", at(emp.user.passwordChangedAt)],
    ["Record created", at(emp.createdAt)],
    ["Record last changed", at(emp.updatedAt)],
  ];

  const sections: PersonSection[] = [
    {
      title: "Profile",
      description: "Contact details, job, dates and pay settings.",
      columns: ["Field", "Value"],
      rows: profile,
    },
    {
      title: "Badges",
      description: "Every badge barcode on file.",
      columns: ["Barcode", "Source", "Added"],
      rows: badges.map((b) => [b.barcode, humanize(b.source), at(b.createdAt)]),
    },
    {
      title: "Pay rates",
      description: "Pay rate history by effective date.",
      columns: ["Effective date", "Rate 1", "Rate 2", "Rate 3", "Markup %", "Charge rate", "Note", "Recorded"],
      rows: payRates.map((r) => [
        formatDay(r.effectiveDate),
        money(r.rate1),
        money(r.rate2),
        money(r.rate3),
        money(r.markupPct),
        money(r.chargeRate),
        r.note,
        at(r.createdAt),
      ]),
    },
    {
      title: "Punches",
      description: "Every punch, with corrections and removals.",
      columns: ["Time", "Rounded time", "Type", "Source", "Pay code", "Approved", "Rejected", "Rejection reason", "Note", "Corrects an earlier punch", "Replaced by a correction", "Recorded"],
      rows: punches.map((p) => [
        at(p.punchTime),
        at(p.roundedTime),
        humanize(p.punchType),
        humanize(p.source),
        p.payCode?.label ?? null,
        yesNo(p.isApproved),
        yesNo(p.isRejected),
        p.rejectionReason,
        p.note,
        yesNo(p.correctsId != null),
        yesNo(p.correctedById != null),
        at(p.createdAt),
      ]),
    },
    {
      title: "Time clock scans",
      description: "Badge scans at the time clocks and gates.",
      columns: ["Time", "Kind", "Direction", "Device", "Site", "Outcome", "Rejection reason"],
      rows: scans.map((s) => [
        at(s.scanTime),
        s.stream === "SECURITY" ? "Gate" : "Time clock",
        humanize(s.direction),
        s.deviceName,
        s.site,
        humanize(s.outcome),
        s.rejectionReason,
      ]),
    },
    {
      title: "Timesheets",
      description: "One row per pay period, with approvals.",
      columns: ["Period start", "Period end", "Status", "Submitted", "Supervisor approved", "Payroll approved", "Locked", "Rejected", "Rejection note", "Overtime authorized"],
      rows: timesheets.map((t) => [
        formatDay(t.payPeriod.startDate),
        formatDay(t.payPeriod.endDate),
        humanize(t.status),
        at(t.submittedAt),
        at(t.supApprovedAt),
        at(t.payrollApprovedAt),
        at(t.lockedAt),
        at(t.rejectedAt),
        t.rejectionNote,
        yesNo(t.otAuthorized),
      ]),
    },
    {
      title: "Timesheet exceptions",
      description: "Missed punches and other flags, and how they were resolved.",
      columns: ["Period start", "Type", "Description", "Occurred", "Resolved", "Resolution"],
      rows: exceptions.map((e) => [formatDay(e.period.startDate), humanize(e.exceptionType), e.description, at(e.occurredAt), at(e.resolvedAt), e.resolution]),
    },
    {
      title: "Timesheet notes",
      description: "Notes written on the timecard.",
      columns: ["Day", "Note", "Written by", "Written"],
      rows: notes.map((n) => [formatDay(n.noteDate), n.note, n.createdByName, at(n.createdAt)]),
    },
    {
      title: "Schedule",
      description: "Scheduled work days and hours.",
      columns: ["Day", "Workday", "Start", "End", "Meal minutes", "Source"],
      rows: schedule.map((d) => [formatDay(d.workDate), yesNo(d.isWorkday), d.startTime, d.endTime, d.mealMinutes, humanize(d.source)]),
    },
    {
      title: "Leave requests",
      description: "Time off requests and their outcome.",
      columns: ["Leave type", "Start", "End", "Hours", "Status", "Note", "Submitted", "Reviewed", "Review note", "Posted", "Cancelled"],
      rows: leaveRequests.map((l) => [
        l.leaveType.name,
        formatDay(l.startDate),
        formatDay(l.endDate),
        hours(l.durationMinutes),
        humanize(l.status),
        l.note,
        at(l.submittedAt),
        at(l.reviewedAt),
        l.reviewNote,
        at(l.postedAt),
        at(l.cancelledAt),
      ]),
    },
    {
      title: "Leave balances",
      description: "Balance and hours used per leave type and year.",
      columns: ["Leave type", "Year", "Balance hours", "Used hours", "Updated"],
      rows: leaveBalances.map((b) => [b.leaveType.name, b.accrualYear, hours(b.balanceMinutes), hours(b.usedMinutes), at(b.updatedAt)]),
    },
    {
      title: "Leave history",
      description: "Every accrual, use and adjustment of a balance.",
      columns: ["When", "Leave type", "Action", "Change hours", "Balance after hours", "Note"],
      rows: ledger.map((x) => [at(x.createdAt), x.leaveType.name, humanize(x.action), hours(x.deltaMinutes), hours(x.balanceAfter), x.note]),
    },
    {
      title: "Gate refusals",
      description: "Days the gate turned the person away.",
      columns: ["Day", "Site", "Reason", "Attempts", "First try", "Last try", "Device", "Dismissed", "Added to schedule"],
      rows: refusals.map((r) => [formatDay(r.workDate), r.site.name, r.reason, r.attempts, at(r.firstAt), at(r.lastAt), r.deviceName, at(r.dismissedAt), at(r.scheduledAt)]),
    },
    {
      title: "Documents",
      description: "Document names and upload dates.",
      columns: ["Title", "File type", "Uploaded"],
      rows: documents.map((d) => [d.title, d.fileType, at(d.uploadedAt)]),
    },
    {
      title: "Change history",
      description: "Changes to the record, and changes the person made.",
      columns: ["When", "Change", "Record", "Made by this person", "Details"],
      rows: audits.map((a) => [
        at(a.createdAt),
        humanize(a.action),
        humanize(a.entityType),
        yesNo(a.actorId === employeeId),
        a.changes == null ? null : JSON.stringify(a.changes),
      ]),
    },
  ];

  return { name: emp.user.name ?? emp.employeeCode, employeeCode: emp.employeeCode, timeZone: tz, sections };
}

/** The workbook: a cover sheet, then one sheet per section, then the photo. */
export async function buildPersonWorkbook(data: PersonExport, exportedAt: Date): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CloudTime";
  workbook.created = exportedAt;

  const cover = workbook.addWorksheet("About this file");
  cover.columns = [{ width: 28 }, { width: 70 }];
  cover.addRow(["Personal data export"]).font = { bold: true, size: 14 };
  cover.addRow([]);
  cover.addRow(["Person", data.name]);
  cover.addRow(["Employee code", data.employeeCode]);
  cover.addRow(["Exported", formatInstant(exportedAt, data.timeZone)]);
  cover.addRow(["Times are shown in", data.timeZone]);
  cover.addRow([]);
  const head = cover.addRow(["Sheet", "What it holds"]);
  head.font = { bold: true };
  for (const s of data.sections) cover.addRow([`${s.title} (${s.rows.length})`, s.description]);
  if (data.photo) cover.addRow(["Photo", "The person's time clock photo."]);

  for (const s of data.sections) {
    const sheet = workbook.addWorksheet(s.title.slice(0, 31));
    sheet.columns = s.columns.map((header) => ({ header, width: Math.min(Math.max(header.length + 4, 14), 40) }));
    const top = sheet.getRow(1);
    top.font = { bold: true, size: 10 };
    top.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (s.rows.length === 0) sheet.addRow(["No records."]);
    for (const row of s.rows) sheet.addRow(row.map((c) => (c == null ? "" : c)));
  }

  if (data.photo) {
    const sheet = workbook.addWorksheet("Photo");
    const id = workbook.addImage({ buffer: data.photo.bytes as unknown as ExcelJS.Buffer, extension: data.photo.extension });
    sheet.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 240, height: 320 } });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
