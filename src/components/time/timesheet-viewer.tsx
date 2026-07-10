"use client";

import { useState, useRef, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  format,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  parseISO,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
} from "lucide-react";
import { parseUtcDate } from "@/lib/utils/date";
import { formatMinutes, minutesToHoursDecimal } from "@/lib/utils/duration";
import { TIMESHEET_STATUS_LABEL, PUNCH_TYPE_LABEL } from "@/lib/state-machines/labels";
import { SegmentTimeline } from "@/components/time/segment-timeline";
import { SubmitTimesheetButton } from "@/components/time/submit-timesheet-button";
import type { WorkSegment } from "@prisma/client";

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
  }[];
  overtimeBuckets: { bucket: string; totalMinutes: number }[];
  exceptionCount: number;
}

export interface TimesheetViewerProps {
  timesheets: TimesheetListItem[];
  selectedPayPeriodId: string | null;
  detail: TimesheetDetailData | null;
  customStart?: string;
  customEnd?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  OPEN:             "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  SUBMITTED:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SUP_APPROVED:     "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  PAYROLL_APPROVED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  LOCKED:           "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

const SUMMARY_BUCKETS = [
  { key: "REG",         label: "Regular",     color: "text-zinc-900 dark:text-white" },
  { key: "OT",          label: "Overtime",    color: "text-amber-600 dark:text-amber-400" },
  { key: "DT",          label: "Double Time", color: "text-red-600 dark:text-red-400" },
  { key: "PTO",         label: "PTO",         color: "text-blue-600 dark:text-blue-400" },
  { key: "SICK",        label: "Sick",        color: "text-purple-600 dark:text-purple-400" },
  { key: "HOLIDAY",     label: "Holiday",     color: "text-green-600 dark:text-green-400" },
  { key: "FMLA",        label: "FMLA",        color: "text-zinc-500 dark:text-zinc-400" },
  { key: "BEREAVEMENT", label: "Bereavement", color: "text-zinc-500 dark:text-zinc-400" },
  { key: "JURY_DUTY",   label: "Jury Duty",   color: "text-zinc-500 dark:text-zinc-400" },
  { key: "MILITARY",    label: "Military",    color: "text-zinc-500 dark:text-zinc-400" },
  { key: "UNPAID",      label: "Unpaid",      color: "text-zinc-400 dark:text-zinc-500" },
];

// ── Component ────────────────────────────────────────────────────────────────

export function TimesheetViewer({
  timesheets,
  selectedPayPeriodId,
  detail,
  customStart,
  customEnd,
}: TimesheetViewerProps) {
  const router = useRouter();
  const [listFilter, setListFilter] = useState<"current" | "last" | "ytd" | "all">("all");

  // Pay period navigation
  const sortedTimesheets = [...timesheets].sort(
    (a, b) =>
      new Date(a.payPeriod.startDate).getTime() -
      new Date(b.payPeriod.startDate).getTime()
  );
  const currentIndex = sortedTimesheets.findIndex(
    (ts) => ts.payPeriodId === selectedPayPeriodId
  );
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < sortedTimesheets.length - 1;

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const currentPeriodTs = sortedTimesheets.find((ts) => {
    const s = parseUtcDate(ts.payPeriod.startDate);
    const e = parseUtcDate(ts.payPeriod.endDate);
    return s <= todayMidnight && todayMidnight <= e;
  });
  const currentPeriodIndex = currentPeriodTs
    ? sortedTimesheets.indexOf(currentPeriodTs)
    : -1;
  const lastPeriodTs =
    currentPeriodIndex > 0
      ? sortedTimesheets[currentPeriodIndex - 1]
      : sortedTimesheets[sortedTimesheets.length - 2];

  const currentYear = new Date().getFullYear();
  const visibleTimesheets =
    listFilter === "current"
      ? currentPeriodTs ? [currentPeriodTs] : []
      : listFilter === "last"
      ? lastPeriodTs ? [lastPeriodTs] : []
      : listFilter === "ytd"
      ? sortedTimesheets.filter(
          (ts) => parseUtcDate(ts.payPeriod.startDate).getFullYear() === currentYear
        )
      : sortedTimesheets;

  // Calendar picker state
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    selectedPayPeriodId
      ? parseUtcDate(
          sortedTimesheets.find((ts) => ts.payPeriodId === selectedPayPeriodId)
            ?.payPeriod.startDate ?? new Date().toISOString()
        )
      : new Date()
  );
  const [rangeStart, setRangeStart] = useState<Date | null>(
    customStart ? new Date(customStart + "T12:00:00") : null
  );
  const [rangeEnd, setRangeEnd] = useState<Date | null>(
    customEnd ? new Date(customEnd + "T12:00:00") : null
  );
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const calendarRef = useRef<HTMLDivElement>(null);

  function toggleDay(key: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    if (showCalendar) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCalendar]);

  function navigate(payPeriodId: string) {
    router.push(`/time/timesheet?payPeriodId=${payPeriodId}`);
  }

  // Auto-select the single period when filter is "current" or "last"
  useEffect(() => {
    if (listFilter === "current" && currentPeriodTs && selectedPayPeriodId !== currentPeriodTs.payPeriodId) {
      navigate(currentPeriodTs.payPeriodId);
    } else if (listFilter === "last" && lastPeriodTs && selectedPayPeriodId !== lastPeriodTs.payPeriodId) {
      navigate(lastPeriodTs.payPeriodId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFilter]);

  function navigateCustomRange(start: Date, end: Date) {
    const s = format(start, "yyyy-MM-dd");
    const e = format(end, "yyyy-MM-dd");
    router.push(`/time/timesheet?customStart=${s}&customEnd=${e}`);
    setShowCalendar(false);
  }

  function handleCalendarDateSelect(d: Date) {
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(d);
      setRangeEnd(null);
      setHoverDate(null);
    } else {
      if (d < rangeStart) {
        setRangeStart(d);
        setRangeEnd(null);
      } else {
        setRangeEnd(d);
        navigateCustomRange(rangeStart, d);
      }
    }
  }

  // Detail computations
  const days =
    detail
      ? eachDayOfInterval({
          start: parseUtcDate(detail.payPeriod.startDate),
          end: parseUtcDate(detail.payPeriod.endDate),
        })
      : [];

  function segmentsForDay(day: Date) {
    return (detail?.segments ?? []).filter(
      (s) =>
        format(parseUtcDate(s.segmentDate), "yyyy-MM-dd") ===
        format(day, "yyyy-MM-dd")
    );
  }

  function punchesForDay(day: Date) {
    return (detail?.punches ?? []).filter(
      (p) =>
        format(parseISO(p.roundedTime), "yyyy-MM-dd") ===
        format(day, "yyyy-MM-dd")
    );
  }

  const bucketMap = Object.fromEntries(
    (detail?.overtimeBuckets ?? []).map((b) => [b.bucket, b.totalMinutes])
  );
  const visibleBuckets = SUMMARY_BUCKETS.filter(
    (b) => b.key === "REG" || (bucketMap[b.key] ?? 0) > 0
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <h1 className="mb-4 text-2xl font-bold text-zinc-900 dark:text-white">My Timesheets</h1>
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      {/* ── Top bar: pay period selector ──────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        {/* List filter dropdown */}
        <select
          value={listFilter}
          onChange={(e) => setListFilter(e.target.value as typeof listFilter)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="current">Current Pay Period</option>
          <option value="last">Last Pay Period</option>
          <option value="ytd">Year to Date</option>
          <option value="all">All Pay Periods</option>
        </select>

        {/* Prev / Next arrows + date display */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => hasPrev && navigate(sortedTimesheets[currentIndex - 1].payPeriodId)}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Previous pay period"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[280px] text-center text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
            {(() => {
              const ts = sortedTimesheets[currentIndex];
              if (!ts && customStart && customEnd) {
                return `${format(new Date(customStart), "MM/dd/yyyy")} – ${format(new Date(customEnd), "MM/dd/yyyy")}`;
              }
              if (!ts) return "—";
              const s = parseUtcDate(ts.payPeriod.startDate);
              const e = parseUtcDate(ts.payPeriod.endDate);
              return `${format(s, "MM/dd/yyyy")} (${format(s, "EEE")}) – ${format(e, "MM/dd/yyyy")} (${format(e, "EEE")})`;
            })()}
          </span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => hasNext && navigate(sortedTimesheets[currentIndex + 1].payPeriodId)}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Next pay period"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Calendar range picker */}
        <div className="relative" ref={calendarRef}>
          <button
            type="button"
            onClick={() => {
              if (!showCalendar) {
                setRangeStart(customStart ? new Date(customStart + "T12:00:00") : null);
                setRangeEnd(customEnd ? new Date(customEnd + "T12:00:00") : null);
                setHoverDate(null);
                const initDate =
                  customStart
                    ? new Date(customStart + "T12:00:00")
                    : sortedTimesheets[currentIndex]
                    ? parseUtcDate(sortedTimesheets[currentIndex].payPeriod.startDate)
                    : new Date();
                setCalendarMonth(initDate);
              }
              setShowCalendar((v) => !v);
            }}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Pick a date range"
          >
            <Calendar className="h-4 w-4" />
          </button>

          {showCalendar && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCalendarMonth((m) => addMonths(m, -1))}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  {format(calendarMonth, "MMMM yyyy")}
                </span>
                <button
                  type="button"
                  onClick={() => setCalendarMonth((m) => addMonths(m, 1))}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-0">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div key={d} className="py-1 text-center text-xs font-medium text-zinc-400">
                    {d}
                  </div>
                ))}
                {(() => {
                  const calDays = eachDayOfInterval({
                    start: startOfWeek(startOfMonth(calendarMonth)),
                    end: endOfWeek(endOfMonth(calendarMonth)),
                  });
                  const effectiveEnd = rangeEnd ?? hoverDate;
                  return calDays.map((d) => {
                    const inMonth = isSameMonth(d, calendarMonth);
                    const isNow = isSameDay(d, new Date());
                    const isStart = !!rangeStart && isSameDay(d, rangeStart);
                    const isEnd = !!rangeEnd && isSameDay(d, rangeEnd);
                    const isEndpoint = isStart || isEnd;
                    const inRange =
                      !!rangeStart && !!effectiveEnd && d > rangeStart && d < effectiveEnd;
                    return (
                      <button
                        key={d.toISOString()}
                        type="button"
                        onClick={() => handleCalendarDateSelect(d)}
                        onMouseEnter={() => rangeStart && !rangeEnd && setHoverDate(d)}
                        onMouseLeave={() => rangeStart && !rangeEnd && setHoverDate(null)}
                        className={`h-7 w-7 rounded text-xs transition-colors ${
                          isEndpoint
                            ? "bg-blue-600 font-semibold text-white"
                            : inRange
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                            : !inMonth
                            ? "text-zinc-300 dark:text-zinc-600"
                            : "text-zinc-700 dark:text-zinc-300"
                        } ${
                          isNow && !isEndpoint && !inRange ? "ring-1 ring-blue-400" : ""
                        } ${!isEndpoint ? "hover:bg-zinc-100 dark:hover:bg-zinc-700" : ""}`}
                      >
                        {d.getDate()}
                      </button>
                    );
                  });
                })()}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-700">
                <span className="text-xs text-zinc-400">
                  {rangeStart && !rangeEnd ? "Select end date" : "Select start date"}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setRangeStart(null);
                      setRangeEnd(null);
                      setHoverDate(null);
                      if (currentPeriodTs) navigate(currentPeriodTs.payPeriodId);
                      setShowCalendar(false);
                    }}
                    className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCalendar(false)}
                    className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <span className="ml-auto text-xs text-zinc-400">
          {visibleTimesheets.length} pay period{visibleTimesheets.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Split pane ───────────────────────────────────────────────────── */}
      <div className="grid h-[calc(100vh-10rem)] grid-cols-[260px_1fr]">

        {/* ── Left: pay period list ─────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col overflow-y-auto border-r border-zinc-200 dark:border-zinc-800">
          {visibleTimesheets.length === 0 && (
            <p className="p-4 text-center text-sm text-zinc-400">
              {timesheets.length === 0 ? "No timesheets yet." : "No timesheets for this filter."}
            </p>
          )}
          {[...visibleTimesheets].reverse().map((ts) => {
            const isSelected = ts.payPeriodId === selectedPayPeriodId;
            const s = parseUtcDate(ts.payPeriod.startDate);
            const e = parseUtcDate(ts.payPeriod.endDate);
            return (
              <button
                key={ts.payPeriodId}
                type="button"
                onClick={() => navigate(ts.payPeriodId)}
                className={`flex flex-col border-b border-zinc-100 px-4 py-3 text-left transition-colors dark:border-zinc-800/60 ${
                  isSelected
                    ? "bg-blue-50 dark:bg-blue-950/30"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-sm font-semibold ${isSelected ? "text-zinc-900 dark:text-white" : "text-zinc-700 dark:text-zinc-300"}`}>
                    {format(s, "MMM d")} – {format(e, "MMM d, yyyy")}
                  </p>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[ts.status] ?? STATUS_BADGE.OPEN}`}>
                    {TIMESHEET_STATUS_LABEL[ts.status] ?? ts.status}
                  </span>
                  <span className="text-xs tabular-nums text-zinc-400">
                    {formatMinutes(ts.totalMinutes)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Right: detail ─────────────────────────────────────────────── */}
        <div className="min-h-0 overflow-y-auto bg-white px-6 py-5 dark:bg-zinc-950">
        {!detail ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-400">
              {timesheets.length === 0
                ? "No timesheets yet. Timesheets are created automatically when you punch in."
                : "No timesheet found for this pay period."}
            </p>
          </div>
        ) : (
          <>
            {/* Status header + submit */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
                  {format(parseUtcDate(detail.payPeriod.startDate), "MMM d")} –{" "}
                  {format(parseUtcDate(detail.payPeriod.endDate), "MMM d, yyyy")}
                </h2>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[detail.status] ?? STATUS_BADGE.OPEN
                    }`}
                  >
                    {TIMESHEET_STATUS_LABEL[detail.status] ?? detail.status}
                  </span>
                  {detail.exceptionCount > 0 && (
                    <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {detail.exceptionCount} exception{detail.exceptionCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
              {detail.status === "OPEN" && (
                <SubmitTimesheetButton timesheetId={detail.timesheetId} />
              )}
            </div>

            {/* Summary tiles */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {visibleBuckets.map((b) => (
                <div
                  key={b.key}
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <p className="text-xs text-zinc-500">{b.label}</p>
                  <p className={`mt-1 text-xl font-bold ${b.color}`}>
                    {formatMinutes(bucketMap[b.key] ?? 0)}
                  </p>
                </div>
              ))}
            </div>

            {/* Daily table */}
            <div className="-mx-6 mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-zinc-200 bg-[#2492c7] dark:border-zinc-700">
                  <tr>
                    <th className="w-7 pl-2 pr-0 py-2.5" />
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Date</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">In</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Out</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-white">Reg</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-white">OT</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-white">DT</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-white">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => {
                    const dayKey = day.toISOString();
                    const dayPunches = punchesForDay(day);
                    const daySegments = segmentsForDay(day);
                    const isWeekend = [0, 6].includes(day.getDay());
                    const isExpanded = expandedDays.has(dayKey);
                    const isTodayRow = isToday(day);
                    const isMonday = day.getDay() === 1;
                    const isFirstDay = days[0].toISOString() === dayKey;
                    const showWeekSeparator = isMonday && !isFirstDay;

                    const buckets: Record<string, number> = {};
                    for (const seg of daySegments) {
                      const eb = seg.payBucketOverride ?? seg.payBucket;
                      buckets[eb] = (buckets[eb] ?? 0) + seg.durationMinutes;
                    }
                    const reg = buckets["REG"] ?? 0;
                    const ot = buckets["OT"] ?? 0;
                    const dt = buckets["DT"] ?? 0;
                    const dailyTotal = daySegments
                      .filter((s) => s.isPaid)
                      .reduce((a, s) => a + s.durationMinutes, 0);

                    const firstIn = dayPunches.find((p) => p.punchType === "CLOCK_IN");
                    const lastOut = [...dayPunches].reverse().find((p) => p.punchType === "CLOCK_OUT");
                    const leaveSegments = daySegments.filter((s) => s.segmentType === "LEAVE");
                    const hasActivity = dayPunches.length > 0 || daySegments.length > 0;

                    const isPast = day < todayMidnight;
                    const isAbsent =
                      !isWeekend &&
                      !isTodayRow &&
                      isPast &&
                      dayPunches.length === 0 &&
                      leaveSegments.length === 0 &&
                      daySegments.length === 0;

                    return (
                      <Fragment key={dayKey}>
                        {showWeekSeparator && (
                          <tr aria-hidden>
                            <td colSpan={8} className="h-0 border-t-2 border-zinc-300 p-0 dark:border-zinc-600" />
                          </tr>
                        )}
                        <tr
                          className={`border-b border-zinc-200 transition-colors dark:border-zinc-700 ${
                            isAbsent
                              ? "bg-red-100 dark:bg-red-950/40"
                              : isTodayRow
                              ? "bg-blue-50/60 dark:bg-blue-950/20"
                              : isWeekend
                              ? "bg-zinc-50/70 dark:bg-zinc-900/40"
                              : hasActivity
                              ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                              : "hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20"
                          } ${hasActivity ? "cursor-pointer" : ""}`}
                          onClick={hasActivity ? () => toggleDay(dayKey) : undefined}
                        >
                          <td className="w-7 pl-2 pr-0 text-center">
                            {hasActivity ? (
                              <ChevronRight
                                className={`inline h-3.5 w-3.5 text-zinc-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              />
                            ) : isTodayRow ? (
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                            ) : null}
                          </td>
                          <td className={`px-3 py-2.5 text-sm tabular-nums ${
                            isAbsent ? "text-red-800 dark:text-red-300"
                            : isTodayRow ? "text-blue-700 dark:text-blue-400"
                            : isWeekend ? "text-zinc-400 dark:text-zinc-500"
                            : "text-zinc-700 dark:text-zinc-300"
                          }`}>
                            <span className={`mr-0.5 ${isWeekend ? "" : "font-semibold"}`}>{format(day, "EEE")}</span>
                            {format(day, "MM/dd/yyyy")}
                          </td>
                          <td className={`px-3 py-2.5 font-mono text-sm ${
                            isAbsent ? "text-red-700 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"
                          }`}>
                            {isAbsent ? (
                              <span className="font-sans text-xs font-semibold">Absent</span>
                            ) : firstIn ? (
                              format(parseISO(firstIn.roundedTime), "h:mm a")
                            ) : leaveSegments.length > 0 ? (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 font-sans text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                                Leave
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-sm text-zinc-700 dark:text-zinc-300">
                            {lastOut ? format(parseISO(lastOut.roundedTime), "h:mm a") : null}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${
                            isAbsent ? "text-red-400 dark:text-red-700"
                            : reg > 0 ? "text-zinc-700 dark:text-zinc-300"
                            : "text-zinc-300 dark:text-zinc-700"
                          }`}>
                            {isAbsent ? "0.00" : reg > 0 ? minutesToHoursDecimal(reg) : "—"}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${
                            isAbsent ? "text-red-400 dark:text-red-700"
                            : ot > 0 ? "font-semibold text-amber-600 dark:text-amber-400"
                            : "text-zinc-300 dark:text-zinc-700"
                          }`}>
                            {ot > 0 ? minutesToHoursDecimal(ot) : "—"}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${
                            isAbsent ? "text-red-400 dark:text-red-700"
                            : dt > 0 ? "font-semibold text-red-600 dark:text-red-400"
                            : "text-zinc-300 dark:text-zinc-700"
                          }`}>
                            {dt > 0 ? minutesToHoursDecimal(dt) : "—"}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${
                            isAbsent ? "font-bold text-red-800 dark:text-red-300"
                            : dailyTotal > 0 ? "font-bold text-zinc-900 dark:text-white"
                            : "text-zinc-300 dark:text-zinc-700"
                          }`}>
                            {isAbsent ? "0.00" : dailyTotal > 0 ? minutesToHoursDecimal(dailyTotal) : "—"}
                          </td>
                        </tr>
                        {isExpanded && hasActivity && (
                          <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/40">
                            <td colSpan={8} className="px-5 py-2">
                              {daySegments.length > 0 && (
                                <div className="mb-2">
                                  <SegmentTimeline
                                    segments={daySegments.map((s) => ({
                                      ...s,
                                      startTime: parseISO(s.startTime),
                                      endTime: parseISO(s.endTime),
                                      segmentDate: parseISO(s.segmentDate),
                                    })) as unknown as WorkSegment[]}
                                    date={day}
                                  />
                                </div>
                              )}
                              <div className="flex flex-wrap items-start gap-2">
                                {dayPunches.map((p) => (
                                  <span
                                    key={p.id}
                                    className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                  >
                                    {PUNCH_TYPE_LABEL[p.punchType]}{" "}
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
              </table>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
    </>
  );
}
