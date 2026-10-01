"use client";

import { Fragment, useState, type CSSProperties } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { addDays, eachDayOfInterval, format, isToday, parseISO } from "date-fns";
import { CalendarX2, ChevronRight } from "lucide-react";

import {
  Badge,
  Banner,
  Card,
  EmptyState,
  SegmentedControl,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  exceptionTone,
  type BannerTone,
} from "@/components/ui";
import { parseUtcDate } from "@/lib/utils/date";
import { minutesToHoursDecimal } from "@/lib/utils/duration";
import { PUNCH_TYPE_LABEL, TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/labels";
import { SegmentTimeline } from "@/components/time/segment-timeline";
import type { WorkSegment } from "@prisma/client";

/**
 * The timecard grid, as the portal design draws Template C.
 *
 * <p>Two header rows and three column groups: what was punched, what the rules
 * engine made of it, and what it was booked against. The vertical rules between
 * the groups are the point of the layout — a clock time and an hours figure are
 * different kinds of number, and run together in one wide row they read as one.
 *
 * <p>The punch cells are the design's `.ta-cell`, in its disabled state. An
 * employee cannot edit their own punches in this product — corrections go
 * through a missed-punch request their supervisor approves — so a live input
 * here would be a field that silently discards what you type. The cells keep
 * the grid's alignment and let clicks through to the row underneath.
 */

// ── Types ───────────────────────────────────────────────────────────────────

interface PayPeriodOption {
  id: string;
  startDate: string;
  endDate: string;
}

export interface TimesheetListItem {
  timesheetId: string;
  payPeriodId: string;
  payPeriod: PayPeriodOption;
  status: string;
  totalMinutes: number;
}

export interface TimesheetDetailData {
  timesheetId: string;
  status: string;
  payPeriod: PayPeriodOption;
  punches: { id: string; punchType: string; roundedTime: string }[];
  segments: {
    id: string;
    segmentType: string;
    segmentDate: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    payBucket: string;
    payBucketOverride: string | null;
    isPaid: boolean;
    leaveTypeName: string | null;
    payCode: { code: number; label: string } | null;
  }[];
  dayReasons: {
    segmentDate: string;
    reasonCode: { code: string; label: string };
  }[];
  overtimeBuckets: { bucket: string; totalMinutes: number }[];
  exceptionCount: number;
}

export interface TimesheetViewerProps {
  timesheets: TimesheetListItem[];
  selectedPayPeriodId: string | null;
  detail: TimesheetDetailData | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Display order and names for the pay buckets the summary can show. */
const BUCKET_ORDER = [
  "REG", "OT", "DT", "PTO", "SICK", "HOLIDAY",
  "FMLA", "BEREAVEMENT", "JURY_DUTY", "MILITARY", "UNPAID",
];

const BUCKET_LABEL: Record<string, string> = {
  REG:         "Regular",
  OT:          "Overtime",
  DT:          "Double Time",
  PTO:         "PTO",
  SICK:        "Sick",
  HOLIDAY:     "Holiday",
  FMLA:        "FMLA",
  BEREAVEMENT: "Bereavement",
  JURY_DUTY:   "Jury Duty",
  MILITARY:    "Military",
  UNPAID:      "Unpaid",
};

const GROUP_ITEMS = [
  { value: "total", label: "Total" },
  { value: "week", label: "Week" },
];

/** The rule that separates the three column groups. */
const RULE = "1px solid var(--stroke-secondary)";

const GROUP_HEAD: CSSProperties = {
  font: "var(--type-overline)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-tertiary)",
  textAlign: "center",
  padding: "6px 4px 0",
  borderBottom: 0,
};

const COL_HEAD: CSSProperties = {
  font: "var(--type-overline)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-secondary)",
  padding: "8px 12px",
  borderBottom: RULE,
  whiteSpace: "nowrap",
};

const HOURS_CELL: CSSProperties = {
  padding: "4px 12px",
  textAlign: "right",
  font: "var(--type-body1)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

/** Eleven columns: date, four punches, four hour figures, pay code, reason. */
const COLUMN_COUNT = 11;

// ── Day model ────────────────────────────────────────────────────────────────

interface DayRow {
  key: string;
  date: Date;
  punchIn: string | null;
  mealOut: string | null;
  mealIn: string | null;
  punchOut: string | null;
  reg: number;
  ot: number;
  dt: number;
  total: number;
  payCode: string | null;
  leaveName: string | null;
  reason: string | null;
  isWeekend: boolean;
  isTodayRow: boolean;
  isAbsent: boolean;
  /** Clocked in on a day that is over, never clocked out. */
  missingOut: boolean;
  hasActivity: boolean;
  segments: TimesheetDetailData["segments"];
  punches: TimesheetDetailData["punches"];
}

/**
 * One row per calendar day of the period, whether or not anything happened on
 * it — a timesheet that only lists the days you worked cannot show the day you
 * forgot to clock in, which is the day people open this screen to find.
 */
function buildDayRows(detail: TimesheetDetailData, todayMidnight: Date): DayRow[] {
  const days = eachDayOfInterval({
    start: parseUtcDate(detail.payPeriod.startDate),
    end: addDays(parseUtcDate(detail.payPeriod.endDate), -1),
  });

  return days.map((day) => {
    const dayStr = format(day, "yyyy-MM-dd");
    const punches = detail.punches.filter(
      (p) => format(parseISO(p.roundedTime), "yyyy-MM-dd") === dayStr,
    );
    const segments = detail.segments.filter(
      (s) => format(parseUtcDate(s.segmentDate), "yyyy-MM-dd") === dayStr,
    );

    const buckets: Record<string, number> = {};
    for (const seg of segments) {
      const eb = seg.payBucketOverride ?? seg.payBucket;
      // Holiday credits display under the REG column (pay code identifies them as holiday)
      const displayBucket = seg.segmentType === "HOLIDAY" ? "REG" : eb;
      buckets[displayBucket] = (buckets[displayBucket] ?? 0) + seg.durationMinutes;
    }

    const firstIn = punches.find((p) => p.punchType === "CLOCK_IN");
    const lastOut = [...punches].reverse().find((p) => p.punchType === "CLOCK_OUT");
    // roundedTime is always toISOString() output, so the strings sort
    // chronologically — this picks the meal-in that closes *this* meal rather
    // than one from an earlier pair.
    const mealOut = punches.find((p) => p.punchType === "MEAL_START");
    const mealIn = punches.find(
      (p) => p.punchType === "MEAL_END" && (!mealOut || p.roundedTime > mealOut.roundedTime),
    );

    const leaveSegments = segments.filter((s) => s.segmentType === "LEAVE");
    const workPayCode = segments.find((s) => s.segmentType === "WORK" && s.payCode)?.payCode;
    const reason = detail.dayReasons.find(
      (r) => format(parseUtcDate(r.segmentDate), "yyyy-MM-dd") === dayStr,
    )?.reasonCode;

    const isWeekend = [0, 6].includes(day.getDay());
    const isTodayRow = isToday(day);
    const isPast = day < todayMidnight;

    const clock = (p?: { roundedTime: string }) =>
      p ? format(parseISO(p.roundedTime), "h:mm a") : null;

    return {
      key: day.toISOString(),
      date: day,
      punchIn: clock(firstIn),
      mealOut: clock(mealOut),
      mealIn: clock(mealIn),
      punchOut: clock(lastOut),
      reg: buckets["REG"] ?? 0,
      ot: buckets["OT"] ?? 0,
      dt: buckets["DT"] ?? 0,
      total: segments.filter((s) => s.isPaid).reduce((a, s) => a + s.durationMinutes, 0),
      payCode: workPayCode ? `${workPayCode.code} · ${workPayCode.label}` : null,
      leaveName: leaveSegments[0]?.leaveTypeName ?? (leaveSegments.length > 0 ? "Leave" : null),
      reason: reason ? `${reason.code} · ${reason.label}` : null,
      isWeekend,
      isTodayRow,
      isAbsent:
        !isWeekend && !isTodayRow && isPast && punches.length === 0 && segments.length === 0,
      // Today's open shift is not a missing punch — you have not finished it yet.
      missingOut: isPast && !isTodayRow && !!firstIn && !lastOut,
      hasActivity: punches.length > 0 || segments.length > 0,
      segments,
      punches,
    };
  });
}

/**
 * The pay period cut into weeks from its own start day.
 *
 * <p>`addDays`, never `+ 6 * 86_400_000`: a period spanning a daylight-saving
 * change lands the millisecond arithmetic an hour off midnight, and the day on
 * the seam then falls outside both weeks — a whole day of hours missing from
 * the summary, twice a year.
 */
function buildWeeks(start: Date, end: Date) {
  const weeks: { key: string; label: string; start: Date; end: Date }[] = [];
  let wStart = start;
  while (wStart <= end) {
    const candidate = addDays(wStart, 6);
    const wEnd = candidate > end ? end : candidate;
    weeks.push({
      key: format(wStart, "yyyy-MM-dd"),
      label: `${format(wStart, "MMM d")} – ${format(wEnd, "MMM d")}`,
      start: wStart,
      end: wEnd,
    });
    wStart = addDays(wEnd, 1);
  }
  return weeks;
}

/**
 * What the banner at the top of the sheet says.
 *
 * <p>Ordered by what stops you: a locked sheet can no longer change, then a
 * punch that is actually missing, then the rule breaks a supervisor will ask
 * about, and only then the plain state.
 */
function sheetBanner(
  detail: TimesheetDetailData,
  missingDays: DayRow[],
): { tone: BannerTone; title: string; body: string; meta?: string } {
  const exc = detail.exceptionCount;
  // The old header carried an exception pill in every state. It rides along as
  // the banner's meta line rather than inside the body, so that a sheet with a
  // missing punch or a locked period does not hide the other things wrong with
  // it.
  const meta =
    exc > 0 ? `${exc} unresolved exception${exc === 1 ? "" : "s"} on this period` : undefined;

  if (detail.status === "LOCKED" || detail.status === "PAYROLL_APPROVED") {
    return {
      tone: "info",
      title: "This period is locked",
      body: "The hours have gone to payroll. A change now needs an adjustment on a later period.",
      meta,
    };
  }

  if (missingDays.length > 0) {
    const named = missingDays.slice(0, 2).map((d) => format(d.date, "EEEE d MMM")).join(" and ");
    const rest = missingDays.length > 2 ? ` and ${missingDays.length - 2} more` : "";
    return {
      tone: "warning",
      title: `Missing a clock-out on ${named}${rest}`,
      body: "Report a missed punch so your supervisor can add it, or the day pays as worked up to your last scan.",
      meta,
    };
  }

  return exc > 0
    ? {
        tone: "warning",
        title: `${exc} unresolved exception${exc === 1 ? "" : "s"} on this timesheet`,
        body: "Your supervisor sees these too. Report what you can so it is fixed before payroll locks the period.",
      }
    : {
        tone: "info",
        title: "This period is open",
        body: "Check the hours below. They can still change until payroll locks the period.",
      };
}

// ── Component ────────────────────────────────────────────────────────────────

export function TimesheetViewer({
  timesheets,
  selectedPayPeriodId,
  detail,
}: TimesheetViewerProps) {
  const router = useRouter();

  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [summaryGroupBy, setSummaryGroupBy] = useState<"total" | "week">("total");
  const [weekIndex, setWeekIndex] = useState<number | null>(null);

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  // Newest first: the period you want is almost always the one that just
  // closed or the one that is open.
  const periodOptions = [...timesheets].sort(
    (a, b) =>
      new Date(b.payPeriod.startDate).getTime() - new Date(a.payPeriod.startDate).getTime(),
  );

  function navigate(payPeriodId: string) {
    router.push(`/time/timesheet?payPeriodId=${payPeriodId}`);
  }

  function toggleDay(key: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const rows = detail ? buildDayRows(detail, todayMidnight) : [];
  const weeks = detail
    ? buildWeeks(
        parseUtcDate(detail.payPeriod.startDate),
        addDays(parseUtcDate(detail.payPeriod.endDate), -1),
      )
    : [];

  // Open on the week containing today so the current period lands where the
  // person is working. The index is clamped rather than keyed to a date, so
  // switching to a shorter period cannot leave the grid pointing at nothing.
  const defaultWeek = Math.max(
    0,
    weeks.findIndex((w) => todayMidnight >= w.start && todayMidnight <= w.end),
  );
  const activeWeek = Math.min(weekIndex ?? defaultWeek, Math.max(0, weeks.length - 1));
  const week = weeks[activeWeek];

  const weekRows = week ? rows.filter((r) => r.date >= week.start && r.date <= week.end) : rows;
  const weekTotals = weekRows.reduce(
    (acc, r) => ({
      reg: acc.reg + r.reg,
      ot: acc.ot + r.ot,
      dt: acc.dt + r.dt,
      total: acc.total + r.total,
    }),
    { reg: 0, ot: 0, dt: 0, total: 0 },
  );

  const banner = detail ? sheetBanner(detail, rows.filter((r) => r.missingOut)) : null;

  const bucketMap: Record<string, number> = Object.fromEntries(
    (detail?.overtimeBuckets ?? []).map((b) => [b.bucket, b.totalMinutes]),
  );

  const periodLabel = detail
    ? `${format(parseUtcDate(detail.payPeriod.startDate), "MMM d")} – ${format(
        addDays(parseUtcDate(detail.payPeriod.endDate), -1),
        "MMM d",
      )}`
    : "";

  const summarySub = detail
    ? `${periodLabel} · ${minutesToHoursDecimal(bucketMap["REG"] ?? 0)} reg · ` +
      `${minutesToHoursDecimal(bucketMap["OT"] ?? 0)} OT · ` +
      `${minutesToHoursDecimal(bucketMap["DT"] ?? 0)} DT`
    : "";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {banner && (
        <Banner tone={banner.tone} title={banner.title} body={banner.body} meta={banner.meta} />
      )}

      <Card padding={0}>
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <label className="flex w-[240px] flex-none flex-col gap-1.5">
            <span className="wms-label">Pay Cycle</span>
            <Select
              value={selectedPayPeriodId ?? ""}
              onChange={(e) => navigate(e.target.value)}
              disabled={periodOptions.length === 0}
              style={{ width: "100%" }}
            >
              {/* Without this, a period id that matches nothing leaves the
                  select showing the newest period while the panel below shows
                  no timecard at all. */}
              {!selectedPayPeriodId && (
                <option value="">
                  {periodOptions.length === 0 ? "No pay periods" : "Select a pay period"}
                </option>
              )}
              {periodOptions.map((ts) => {
                const s = parseUtcDate(ts.payPeriod.startDate);
                const e = addDays(parseUtcDate(ts.payPeriod.endDate), -1);
                const status =
                  (TIMESHEET_STATUS_LABEL as Record<string, string>)[ts.status] ?? ts.status;
                return (
                  <option key={ts.payPeriodId} value={ts.payPeriodId}>
                    {format(s, "MMM d")} – {format(e, "MMM d, yyyy")} · {status} ·{" "}
                    {minutesToHoursDecimal(ts.totalMinutes)} h
                  </option>
                );
              })}
            </Select>
          </label>

          {weeks.length > 1 && (
            <div className="self-end">
              <SegmentedControl
                items={weeks.map((w, i) => ({ value: String(i), label: w.label }))}
                value={String(activeWeek)}
                onChange={(v) => setWeekIndex(Number(v))}
                size="sm"
                ariaLabel="Week of the pay period"
              />
            </div>
          )}

          <div className="flex-1" />

          <div
            className="self-end"
            style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
          >
            {detail
              ? "Punches are read-only here · Report a missed punch to correct one"
              : "Pick a pay period to see its timecard"}
          </div>
        </div>

        {!detail || rows.length === 0 ? (
          <EmptyState
            icon={<CalendarX2 className="h-8 w-8" />}
            title={
              timesheets.length === 0 ? "No timesheets yet" : "No timesheet for this pay period"
            }
            body={
              timesheets.length === 0
                ? "A timesheet is created for you automatically the first time you punch in."
                : "Nothing was recorded against this period. Pick another from the Pay Cycle list."
            }
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: 0 }} />
                  <th colSpan={4} style={GROUP_HEAD}>Punches</th>
                  <th colSpan={4} style={{ ...GROUP_HEAD, borderLeft: RULE, padding: "6px 12px 0" }}>
                    Calculated Hours
                  </th>
                  <th colSpan={2} style={{ borderBottom: 0, borderLeft: RULE }} />
                </tr>
                <tr style={{ background: "var(--surface-tertiary)" }}>
                  <th style={{ ...COL_HEAD, textAlign: "left" }}>Date</th>
                  <th style={{ ...COL_HEAD, textAlign: "center", padding: "8px 3px" }}>In</th>
                  <th style={{ ...COL_HEAD, textAlign: "center", padding: "8px 3px" }}>Meal Out</th>
                  <th style={{ ...COL_HEAD, textAlign: "center", padding: "8px 3px" }}>Meal In</th>
                  <th style={{ ...COL_HEAD, textAlign: "center", padding: "8px 3px" }}>Out</th>
                  <th style={{ ...COL_HEAD, textAlign: "right", borderLeft: RULE, paddingLeft: 20 }}>
                    Reg
                  </th>
                  <th style={{ ...COL_HEAD, textAlign: "right" }}>OT</th>
                  <th style={{ ...COL_HEAD, textAlign: "right" }}>DT</th>
                  <th style={{ ...COL_HEAD, textAlign: "right" }}>Total</th>
                  <th style={{ ...COL_HEAD, textAlign: "left", borderLeft: RULE, paddingLeft: 20 }}>
                    Pay Code
                  </th>
                  <th style={{ ...COL_HEAD, textAlign: "left" }}>Reason</th>
                </tr>
              </thead>

              <tbody>
                {weekRows.map((row) => {
                  const expanded = expandedDays.has(row.key);
                  return (
                    <Fragment key={row.key}>
                      <tr
                        className="ta-row"
                        style={{
                          borderBottom: "1px solid var(--stroke-divider)",
                          background: rowBackground(row),
                          cursor: row.hasActivity ? "pointer" : undefined,
                        }}
                        onClick={row.hasActivity ? () => toggleDay(row.key) : undefined}
                      >
                        <td style={{ padding: "4px 12px", font: "var(--type-body1)", whiteSpace: "nowrap" }}>
                          <span className="flex items-center gap-1.5">
                            <ChevronRight
                              className="h-3.5 w-3.5 flex-none transition-transform"
                              style={{
                                color: "var(--icon-tertiary)",
                                visibility: row.hasActivity ? undefined : "hidden",
                                transform: expanded ? "rotate(90deg)" : undefined,
                              }}
                              aria-hidden
                            />
                            <span style={{ fontWeight: "var(--weight-medium)" }}>
                              {format(row.date, "EEE")}
                            </span>
                            <span className="tabular" style={{ color: "var(--text-tertiary)" }}>
                              {format(row.date, "MM/dd")}
                            </span>
                          </span>
                        </td>

                        <PunchCell value={row.punchIn} label="Clock in" row={row} />
                        <PunchCell value={row.mealOut} label="Meal out" row={row} />
                        <PunchCell value={row.mealIn} label="Meal in" row={row} />
                        <PunchCell value={row.punchOut} label="Clock out" row={row} flagged={row.missingOut} />

                        <td style={{ ...HOURS_CELL, borderLeft: RULE, paddingLeft: 20, ...hoursStyle(row.reg, row.isAbsent) }}>
                          {row.isAbsent ? "0.00" : row.reg > 0 ? minutesToHoursDecimal(row.reg) : "—"}
                        </td>
                        <td style={{ ...HOURS_CELL, ...hoursStyle(row.ot, row.isAbsent, "var(--text-warning)") }}>
                          {row.ot > 0 ? minutesToHoursDecimal(row.ot) : "—"}
                        </td>
                        <td style={{ ...HOURS_CELL, ...hoursStyle(row.dt, row.isAbsent, "var(--text-error)") }}>
                          {row.dt > 0 ? minutesToHoursDecimal(row.dt) : "—"}
                        </td>
                        <td
                          style={{
                            ...HOURS_CELL,
                            ...hoursStyle(row.total, row.isAbsent),
                            ...(row.total > 0 || row.isAbsent
                              ? { fontWeight: "var(--weight-semibold)" }
                              : {}),
                          }}
                        >
                          {row.isAbsent ? "0.00" : row.total > 0 ? minutesToHoursDecimal(row.total) : "—"}
                        </td>

                        <td
                          style={{
                            padding: "4px 12px 4px 20px",
                            font: "var(--type-body2)",
                            color: "var(--text-secondary)",
                            borderLeft: RULE,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.isAbsent ? (
                            <Badge tone={exceptionTone("ABSENT")} size="sm">Absent</Badge>
                          ) : (
                            row.payCode ?? row.leaveName ?? ""
                          )}
                        </td>
                        <td
                          style={{
                            padding: "4px 12px",
                            font: "var(--type-body2)",
                            color: "var(--text-secondary)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.reason ?? ""}
                        </td>
                      </tr>

                      {expanded && row.hasActivity && (
                        <tr style={{ background: "var(--surface-secondary)" }}>
                          <td
                            colSpan={COLUMN_COUNT}
                            style={{
                              padding: "10px 20px",
                              borderBottom: "1px solid var(--stroke-divider)",
                            }}
                          >
                            {row.segments.length > 0 && (
                              <div className="mb-2">
                                <SegmentTimeline
                                  segments={row.segments.map((s) => ({
                                    ...s,
                                    startTime: parseISO(s.startTime),
                                    endTime: parseISO(s.endTime),
                                    segmentDate: parseISO(s.segmentDate),
                                  })) as unknown as WorkSegment[]}
                                  date={row.date}
                                />
                              </div>
                            )}
                            <div className="flex flex-wrap items-start gap-2">
                              {row.punches.map((p) => (
                                <span
                                  key={p.id}
                                  className="tabular"
                                  style={{
                                    background: "var(--surface-tertiary)",
                                    color: "var(--text-secondary)",
                                    font: "var(--type-body2)",
                                    borderRadius: "var(--radius-s)",
                                    padding: "2px 8px",
                                  }}
                                >
                                  {(PUNCH_TYPE_LABEL as Record<string, string>)[p.punchType] ??
                                    p.punchType}{" "}
                                  {format(parseISO(p.roundedTime), "h:mm a")}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>

              <tfoot>
                <tr
                  style={{
                    background: "var(--surface-tertiary)",
                    fontWeight: "var(--weight-semibold)",
                  }}
                >
                  <td style={{ padding: "10px 12px", font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", whiteSpace: "nowrap" }}>
                    {week ? `Week total · ${week.label}` : "Period total"}
                  </td>
                  <td colSpan={4} />
                  <td style={{ ...HOURS_CELL, padding: "10px 12px 10px 20px", borderLeft: RULE, fontWeight: "var(--weight-semibold)" }}>
                    {minutesToHoursDecimal(weekTotals.reg)}
                  </td>
                  <td style={{ ...HOURS_CELL, padding: "10px 12px", fontWeight: "var(--weight-semibold)" }}>
                    {minutesToHoursDecimal(weekTotals.ot)}
                  </td>
                  <td style={{ ...HOURS_CELL, padding: "10px 12px", fontWeight: "var(--weight-semibold)" }}>
                    {minutesToHoursDecimal(weekTotals.dt)}
                  </td>
                  <td style={{ ...HOURS_CELL, padding: "10px 12px", fontWeight: "var(--weight-semibold)" }}>
                    {minutesToHoursDecimal(weekTotals.total)}
                  </td>
                  <td colSpan={2} style={{ borderLeft: RULE }} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {detail && rows.length > 0 && (
          <div
            className="px-4 py-2.5"
            style={{
              borderTop: "1px solid var(--stroke-divider)",
              font: "var(--type-body2)",
              color: "var(--text-secondary)",
              textWrap: "pretty",
            }}
          >
            Click a day to see its segments · Hours are what the rules engine produced, with
            rounding and meal deductions already applied
          </div>
        )}
      </Card>

      {detail && (
        <Card padding={0}>
          <div
            className="flex flex-wrap items-center gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid var(--stroke-divider)" }}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>
                Period Summary
              </span>
              <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                {summarySub}
              </span>
            </div>
            <div className="flex-1" />
            <div className="flex flex-none items-center gap-2">
              <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                Group by
              </span>
              <SegmentedControl
                items={GROUP_ITEMS}
                value={summaryGroupBy}
                onChange={(v) => setSummaryGroupBy(v as "total" | "week")}
                size="sm"
                ariaLabel="Group the period summary by"
              />
            </div>
          </div>

          <Table>
            <THead>
              <TR>
                <TH>{summaryGroupBy === "week" ? "Week" : "Category"}</TH>
                <TH numeric>Reg Hrs</TH>
                <TH numeric>OT</TH>
                <TH numeric>DT</TH>
                <TH numeric>Total Hrs</TH>
              </TR>
            </THead>
            <TBody>
              {summaryGroupBy === "total" ? (
                <TotalSummary bucketMap={bucketMap} />
              ) : (
                <WeekSummary detail={detail} weeks={weeks} />
              )}
            </TBody>
          </Table>
        </Card>
      )}

    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** The row tint: absent and missing-punch days in error, today in accent. */
function rowBackground(row: DayRow): string | undefined {
  if (row.isAbsent || row.missingOut) return "var(--surface-error)";
  if (row.isTodayRow) return "var(--surface-info)";
  if (row.isWeekend) return "var(--surface-tertiary)";
  return undefined;
}

/**
 * Builds only the style keys a figure actually needs.
 *
 * <p>Spreading a key with an undefined value onto a base style erases the base
 * value rather than falling back to it, which is how a "no override" branch
 * silently un-colours every cell in the column.
 */
function hoursStyle(minutes: number, isAbsent: boolean, tone?: string): CSSProperties {
  if (isAbsent) return { color: "var(--text-error)" };
  if (minutes <= 0) return { color: "var(--text-disabled)" };
  if (tone) return { color: tone, fontWeight: "var(--weight-semibold)" };
  return {};
}

/**
 * One punch time in the grid.
 *
 * <p>`pointerEvents: none` so a click lands on the row and expands the day —
 * a disabled input swallows the event, and the four widest cells in the row
 * would otherwise be the four that do nothing.
 */
function PunchCell({
  value,
  label,
  row,
  flagged = false,
}: {
  value: string | null;
  label: string;
  row: DayRow;
  flagged?: boolean;
}) {
  return (
    <td style={{ padding: "4px 3px" }}>
      <input
        className="ta-cell"
        value={value ?? ""}
        placeholder="--:--"
        disabled
        readOnly
        aria-label={`${label} ${format(row.date, "EEE d MMM")}`}
        style={{
          pointerEvents: "none",
          ...(flagged ? { borderColor: "var(--stroke-error)" } : {}),
        }}
      />
    </td>
  );
}

/** Period totals by pay bucket, the way payroll reads them. */
function TotalSummary({ bucketMap }: { bucketMap: Record<string, number> }) {
  const reg = bucketMap["REG"] ?? 0;
  const ot = bucketMap["OT"] ?? 0;
  const dt = bucketMap["DT"] ?? 0;
  const total = Object.values(bucketMap).reduce((a, b) => a + b, 0);
  const others = BUCKET_ORDER.filter(
    (key) => !["REG", "OT", "DT"].includes(key) && (bucketMap[key] ?? 0) > 0,
  );

  return (
    <>
      {others.map((key) => (
        <SummaryRow
          key={key}
          label={BUCKET_LABEL[key] ?? key}
          reg={0}
          ot={0}
          dt={0}
          total={bucketMap[key] ?? 0}
        />
      ))}
      <SummaryRow label="Totals" reg={reg} ot={ot} dt={dt} total={total} emphasis />
    </>
  );
}

/** The same totals split by week, for periods longer than one. */
function WeekSummary({
  detail,
  weeks,
}: {
  detail: TimesheetDetailData;
  weeks: { key: string; label: string; start: Date; end: Date }[];
}) {
  const perWeek = weeks.map((week) => {
    const wb: Record<string, number> = {};
    for (const s of detail.segments) {
      const sd = parseUtcDate(s.segmentDate);
      if (sd < week.start || sd > week.end || !s.isPaid) continue;
      const eb = s.payBucketOverride ?? s.payBucket;
      wb[eb] = (wb[eb] ?? 0) + s.durationMinutes;
    }
    return {
      key: week.key,
      label: week.label,
      reg: wb["REG"] ?? 0,
      ot: wb["OT"] ?? 0,
      dt: wb["DT"] ?? 0,
      total: Object.values(wb).reduce((a, b) => a + b, 0),
    };
  });

  const grand = perWeek.reduce(
    (acc, w) => ({
      reg: acc.reg + w.reg,
      ot: acc.ot + w.ot,
      dt: acc.dt + w.dt,
      total: acc.total + w.total,
    }),
    { reg: 0, ot: 0, dt: 0, total: 0 },
  );

  return (
    <>
      {perWeek.map((w) => (
        <SummaryRow key={w.key} label={w.label} reg={w.reg} ot={w.ot} dt={w.dt} total={w.total} />
      ))}
      <SummaryRow
        label="Totals"
        reg={grand.reg}
        ot={grand.ot}
        dt={grand.dt}
        total={grand.total}
        emphasis
      />
    </>
  );
}

function SummaryRow({
  label,
  reg,
  ot,
  dt,
  total,
  emphasis = false,
}: {
  label: string;
  reg: number;
  ot: number;
  dt: number;
  total: number;
  emphasis?: boolean;
}) {
  const fmt = minutesToHoursDecimal;
  const strong: CSSProperties = emphasis
    ? { fontWeight: "var(--weight-semibold)" }
    : { color: "var(--text-secondary)" };

  return (
    <TR style={emphasis ? { background: "var(--surface-tertiary)" } : undefined}>
      <TD style={emphasis ? { fontWeight: "var(--weight-semibold)" } : undefined}>{label}</TD>
      <TD numeric style={strong}>{reg > 0 ? fmt(reg) : "—"}</TD>
      <TD numeric style={ot > 0 ? { color: "var(--text-warning)", fontWeight: "var(--weight-semibold)" } : strong}>
        {ot > 0 ? fmt(ot) : "—"}
      </TD>
      <TD numeric style={dt > 0 ? { color: "var(--text-error)", fontWeight: "var(--weight-semibold)" } : strong}>
        {dt > 0 ? fmt(dt) : "—"}
      </TD>
      <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>{total > 0 ? fmt(total) : "—"}</TD>
    </TR>
  );
}
