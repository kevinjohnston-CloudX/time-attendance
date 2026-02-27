"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, eachDayOfInterval, parseISO } from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";
import { minutesToHoursDecimal } from "@/lib/utils/duration";
import {
  PAY_BUCKET_LABEL,
  ALL_PAY_BUCKETS,
  type PayBucketValue,
} from "@/lib/utils/pay-bucket";
import {
  TIMESHEET_STATUS_LABEL,
  PUNCH_TYPE_LABEL,
  type TimesheetStatusValue,
  type PunchTypeValue,
} from "@/lib/state-machines/labels";
import { correctPunch } from "@/actions/punch.actions";
import {
  approveTimesheet,
  payrollApproveTimesheet,
  rejectTimesheet,
} from "@/actions/timesheet.actions";
import { Search, ChevronRight, Pencil } from "lucide-react";

// ─── Serialized prop types (dates as ISO strings) ────────────────────────────

type EmployeeListItem = {
  timesheetId: string;
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  status: string;
  totalMinutes: number;
};

type PayPeriodOption = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
};

type TimecardPunch = {
  id: string;
  punchType: string;
  roundedTime: string;
};

type TimecardSegment = {
  id: string;
  segmentType: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  segmentDate: string;
  payBucket: string;
  isPaid: boolean;
};

type TimecardBucket = {
  bucket: string;
  totalMinutes: number;
};

type TimecardDetail = {
  timesheetId: string;
  status: string;
  exceptionCount: number;
  payPeriod: { startDate: string; endDate: string };
  employee: {
    user: { name: string | null } | null;
    department: { name: string };
    employeeCode: string;
  };
  punches: TimecardPunch[];
  segments: TimecardSegment[];
  overtimeBuckets: TimecardBucket[];
};

interface TimecardViewerProps {
  payPeriods: PayPeriodOption[];
  selectedPayPeriodId: string;
  employees: EmployeeListItem[];
  selectedEmployeeId: string | null;
  timecard: TimecardDetail | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_DOT: Record<string, string> = {
  LOCKED: "bg-zinc-400",
  PAYROLL_APPROVED: "bg-emerald-500",
  SUP_APPROVED: "bg-blue-500",
  SUBMITTED: "bg-sky-400",
  OPEN: "bg-zinc-300 dark:bg-zinc-600",
  REJECTED: "bg-red-500",
};

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  SUBMITTED: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  SUP_APPROVED:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  PAYROLL_APPROVED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  LOCKED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function TimecardViewer({
  payPeriods,
  selectedPayPeriodId,
  employees,
  selectedEmployeeId,
  timecard,
}: TimecardViewerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  // Expandable rows
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Punch editing
  const [editingPunchId, setEditingPunchId] = useState<string | null>(null);
  const [editNewTime, setEditNewTime] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Rejection form
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  // Reset state when employee changes
  useEffect(() => {
    setExpandedDays(new Set());
    setEditingPunchId(null);
    setEditError(null);
    setShowRejectForm(false);
    setRejectNote("");
  }, [timecard?.timesheetId]);

  const canEdit =
    timecard &&
    timecard.status !== "LOCKED" &&
    timecard.status !== "PAYROLL_APPROVED";

  const filteredEmployees = employees.filter((emp) => {
    const q = search.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.employeeCode.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q)
    );
  });

  function navigate(payPeriodId: string, employeeId?: string | null) {
    const params = new URLSearchParams({ payPeriodId });
    if (employeeId) params.set("employeeId", employeeId);
    router.push(`/payroll/timecards?${params.toString()}`);
  }

  // Build daily data from timecard
  const days =
    timecard &&
    eachDayOfInterval({
      start: parseUtcDate(timecard.payPeriod.startDate),
      end: parseUtcDate(timecard.payPeriod.endDate),
    });

  function segmentsForDay(day: Date): TimecardSegment[] {
    if (!timecard) return [];
    const dayStr = format(day, "yyyy-MM-dd");
    return timecard.segments.filter(
      (s) => format(parseUtcDate(s.segmentDate), "yyyy-MM-dd") === dayStr
    );
  }

  function punchesForDay(day: Date): TimecardPunch[] {
    if (!timecard) return [];
    const dayStr = format(day, "yyyy-MM-dd");
    return timecard.punches.filter(
      (p) => format(parseISO(p.roundedTime), "yyyy-MM-dd") === dayStr
    );
  }

  function toggleDay(dayKey: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) {
        next.delete(dayKey);
        // Cancel editing if we collapse
        setEditingPunchId(null);
      } else {
        next.add(dayKey);
      }
      return next;
    });
  }

  function startEditing(punch: TimecardPunch, dayKey: string) {
    if (!canEdit) return;
    // Expand the day if not already
    setExpandedDays((prev) => new Set(prev).add(dayKey));
    setEditingPunchId(punch.id);
    setEditNewTime(toDatetimeLocal(parseISO(punch.roundedTime)));
    setEditReason("");
    setEditError(null);
  }

  function cancelEditing() {
    setEditingPunchId(null);
    setEditError(null);
  }

  function handleCorrectPunch(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPunchId) return;
    setEditError(null);
    startTransition(async () => {
      const result = await correctPunch({
        originalPunchId: editingPunchId,
        newPunchTime: new Date(editNewTime).toISOString(),
        reason: editReason,
      });
      if (!result.success) {
        setEditError(result.error);
        return;
      }
      setEditingPunchId(null);
      router.refresh();
    });
  }

  function handleApprove() {
    if (!timecard) return;
    startTransition(async () => {
      const action =
        timecard.status === "SUP_APPROVED"
          ? payrollApproveTimesheet
          : approveTimesheet;
      const result = await action({ timesheetId: timecard.timesheetId });
      if (!result.success) alert(result.error);
      else router.refresh();
    });
  }

  function handleReject(e: React.FormEvent) {
    e.preventDefault();
    if (!timecard) return;
    startTransition(async () => {
      const result = await rejectTimesheet({
        timesheetId: timecard.timesheetId,
        note: rejectNote,
      });
      if (!result.success) {
        alert(result.error);
        return;
      }
      setShowRejectForm(false);
      setRejectNote("");
      router.refresh();
    });
  }

  const canApprove =
    timecard &&
    (timecard.status === "SUBMITTED" || timecard.status === "SUP_APPROVED");
  const canReject =
    timecard &&
    (timecard.status === "SUBMITTED" || timecard.status === "SUP_APPROVED");

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      {/* ── Top bar: pay period selector ─────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Pay Period
        </label>
        <select
          value={selectedPayPeriodId}
          onChange={(e) => navigate(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          {payPeriods.map((pp) => (
            <option key={pp.id} value={pp.id}>
              {format(parseUtcDate(pp.startDate), "MMM d")} –{" "}
              {format(parseUtcDate(pp.endDate), "MMM d, yyyy")}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-zinc-400">
          {employees.length} employee{employees.length !== 1 && "s"}
        </span>
      </div>

      {/* ── Split pane ───────────────────────────────────────────────── */}
      <div className="grid h-[calc(100vh-14rem)] grid-cols-[260px_1fr]">
        {/* ── Left: employee list ─────────────────────────────────────── */}
        <div className="flex flex-col border-r border-zinc-200 dark:border-zinc-800">
          <div className="border-b border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search employees…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
            {filteredEmployees.length === 0 && (
              <p className="p-4 text-center text-sm text-zinc-400">
                No employees found.
              </p>
            )}
            {filteredEmployees.map((emp) => {
              const isSelected = emp.employeeId === selectedEmployeeId;
              return (
                <button
                  key={emp.employeeId}
                  onClick={() => navigate(selectedPayPeriodId, emp.employeeId)}
                  className={`flex w-full items-start gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-left transition-colors dark:border-zinc-800/60 ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-950/30"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      STATUS_DOT[emp.status] ?? "bg-zinc-300"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm font-medium ${
                        isSelected
                          ? "text-zinc-900 dark:text-white"
                          : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      {emp.name}
                    </p>
                    <p className="truncate text-xs text-zinc-400">
                      {emp.employeeCode} · {emp.department}
                    </p>
                  </div>
                  <span className="mt-0.5 shrink-0 text-xs tabular-nums text-zinc-500">
                    {minutesToHoursDecimal(emp.totalMinutes)}h
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: timecard detail ──────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden bg-white dark:bg-zinc-950">
          {!timecard || !days ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-zinc-400">
                {employees.length === 0
                  ? "No timesheets for this pay period."
                  : "Select an employee to view their timecard."}
              </p>
            </div>
          ) : (
            <>
              {/* ── Employee header with status + actions ─────────────── */}
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="text-base font-bold text-zinc-900 dark:text-white">
                      {timecard.employee.user?.name ??
                        timecard.employee.employeeCode}
                    </h2>
                    <p className="text-xs text-zinc-500">
                      {timecard.employee.employeeCode} ·{" "}
                      {timecard.employee.department.name}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[timecard.status] ?? STATUS_BADGE.OPEN
                    }`}
                  >
                    {TIMESHEET_STATUS_LABEL[
                      timecard.status as TimesheetStatusValue
                    ] ?? timecard.status}
                  </span>
                  {timecard.exceptionCount > 0 && (
                    <span className="text-xs text-amber-500">
                      {timecard.exceptionCount} exception
                      {timecard.exceptionCount !== 1 && "s"}
                    </span>
                  )}
                </div>

                {/* Approval / Reject */}
                <div className="flex items-center gap-2">
                  {showRejectForm ? (
                    <form
                      onSubmit={handleReject}
                      className="flex items-center gap-2"
                    >
                      <input
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Reason for rejection…"
                        required
                        className="w-48 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={isPending || !rejectNote.trim()}
                        className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {isPending ? "…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowRejectForm(false);
                          setRejectNote("");
                        }}
                        className="text-xs text-zinc-500 hover:text-zinc-700"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      {canReject && (
                        <button
                          onClick={() => setShowRejectForm(true)}
                          disabled={isPending}
                          className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          Reject
                        </button>
                      )}
                      {canApprove && (
                        <button
                          onClick={handleApprove}
                          disabled={isPending}
                          className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {isPending
                            ? "Saving…"
                            : timecard.status === "SUP_APPROVED"
                              ? "Payroll Approve"
                              : "Approve"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ── Scrollable timecard table + summary ──────────────── */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                    <tr>
                      <th className="w-6 px-1 py-2" />
                      <th className="px-3 py-2 text-left font-medium text-zinc-500">
                        Date
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500">
                        Day
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500">
                        In
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500">
                        Out
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500">
                        Reg
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500">
                        OT
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500">
                        DT
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {days.map((day) => {
                      const dayKey = day.toISOString();
                      const dayPunches = punchesForDay(day);
                      const daySegments = segmentsForDay(day);
                      const isWeekend = [0, 6].includes(day.getDay());
                      const isExpanded = expandedDays.has(dayKey);

                      const buckets: Record<string, number> = {};
                      for (const seg of daySegments) {
                        buckets[seg.payBucket] =
                          (buckets[seg.payBucket] ?? 0) + seg.durationMinutes;
                      }

                      const reg = buckets["REG"] ?? 0;
                      const ot = buckets["OT"] ?? 0;
                      const dt = buckets["DT"] ?? 0;
                      const dailyTotal = daySegments
                        .filter((s) => s.isPaid)
                        .reduce((a, s) => a + s.durationMinutes, 0);

                      const clockIns = dayPunches.filter(
                        (p) => p.punchType === "CLOCK_IN"
                      );
                      const clockOuts = dayPunches.filter(
                        (p) => p.punchType === "CLOCK_OUT"
                      );
                      const firstIn = clockIns[0];
                      const lastOut = clockOuts[clockOuts.length - 1];

                      const leaveBuckets = daySegments
                        .filter(
                          (s) =>
                            s.payBucket !== "REG" &&
                            s.payBucket !== "OT" &&
                            s.payBucket !== "DT" &&
                            s.payBucket !== "UNPAID" &&
                            s.segmentType !== "WORK" &&
                            s.segmentType !== "MEAL" &&
                            s.segmentType !== "BREAK"
                        )
                        .map((s) => s.payBucket);
                      const uniqueLeave = [...new Set(leaveBuckets)];

                      const hasActivity =
                        dayPunches.length > 0 || daySegments.length > 0;
                      const hasPunches = dayPunches.length > 0;

                      return (
                        <>
                          {/* Day summary row */}
                          <tr
                            key={dayKey}
                            className={`${
                              isWeekend
                                ? "bg-zinc-50/60 dark:bg-zinc-900/30"
                                : ""
                            } ${hasPunches ? "cursor-pointer" : ""}`}
                            onClick={
                              hasPunches
                                ? () => toggleDay(dayKey)
                                : undefined
                            }
                          >
                            <td className="px-1 py-1.5 text-center">
                              {hasPunches && (
                                <ChevronRight
                                  className={`inline h-3.5 w-3.5 text-zinc-400 transition-transform ${
                                    isExpanded ? "rotate-90" : ""
                                  }`}
                                />
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">
                              {format(day, "MM/dd")}
                            </td>
                            <td
                              className={`px-3 py-1.5 ${
                                isWeekend
                                  ? "text-zinc-400"
                                  : "text-zinc-700 dark:text-zinc-300"
                              }`}
                            >
                              {format(day, "EEE")}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                              {firstIn ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditing(firstIn, dayKey);
                                  }}
                                  disabled={!canEdit}
                                  className={
                                    canEdit
                                      ? "rounded px-1 py-0.5 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                      : ""
                                  }
                                >
                                  {format(
                                    parseISO(firstIn.roundedTime),
                                    "h:mm a"
                                  )}
                                </button>
                              ) : uniqueLeave.length > 0 ? (
                                uniqueLeave
                                  .map(
                                    (b) =>
                                      PAY_BUCKET_LABEL[
                                        b as PayBucketValue
                                      ] ?? b
                                  )
                                  .join(", ")
                              ) : hasActivity ? (
                                "—"
                              ) : (
                                ""
                              )}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                              {lastOut ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditing(lastOut, dayKey);
                                  }}
                                  disabled={!canEdit}
                                  className={
                                    canEdit
                                      ? "rounded px-1 py-0.5 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                      : ""
                                  }
                                >
                                  {format(
                                    parseISO(lastOut.roundedTime),
                                    "h:mm a"
                                  )}
                                </button>
                              ) : (
                                ""
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                              {reg > 0 ? minutesToHoursDecimal(reg) : ""}
                            </td>
                            <td
                              className={`px-3 py-1.5 text-right tabular-nums ${
                                ot > 0
                                  ? "font-medium text-amber-600 dark:text-amber-400"
                                  : "text-zinc-400"
                              }`}
                            >
                              {ot > 0 ? minutesToHoursDecimal(ot) : ""}
                            </td>
                            <td
                              className={`px-3 py-1.5 text-right tabular-nums ${
                                dt > 0
                                  ? "font-medium text-red-600 dark:text-red-400"
                                  : "text-zinc-400"
                              }`}
                            >
                              {dt > 0 ? minutesToHoursDecimal(dt) : ""}
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium tabular-nums text-zinc-900 dark:text-white">
                              {dailyTotal > 0
                                ? minutesToHoursDecimal(dailyTotal)
                                : ""}
                            </td>
                          </tr>

                          {/* Expanded punch detail row */}
                          {isExpanded && hasPunches && (
                            <tr
                              key={`${dayKey}-detail`}
                              className="bg-zinc-50/80 dark:bg-zinc-900/40"
                            >
                              <td colSpan={9} className="px-5 py-2">
                                <div className="flex flex-wrap items-start gap-2">
                                  {dayPunches.map((punch) =>
                                    editingPunchId === punch.id ? (
                                      <form
                                        key={punch.id}
                                        onSubmit={handleCorrectPunch}
                                        className="flex w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950/30"
                                      >
                                        <span className="shrink-0 text-xs font-medium text-blue-800 dark:text-blue-300">
                                          {PUNCH_TYPE_LABEL[
                                            punch.punchType as PunchTypeValue
                                          ] ?? punch.punchType}
                                        </span>
                                        <input
                                          type="datetime-local"
                                          value={editNewTime}
                                          onChange={(e) =>
                                            setEditNewTime(e.target.value)
                                          }
                                          required
                                          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                                        />
                                        <input
                                          value={editReason}
                                          onChange={(e) =>
                                            setEditReason(e.target.value)
                                          }
                                          placeholder="Reason…"
                                          required
                                          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                                          autoFocus
                                        />
                                        <button
                                          type="submit"
                                          disabled={
                                            isPending ||
                                            !editReason.trim()
                                          }
                                          className="shrink-0 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                        >
                                          {isPending ? "Saving…" : "Save"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelEditing}
                                          className="shrink-0 text-xs text-zinc-500 hover:text-zinc-700"
                                        >
                                          Cancel
                                        </button>
                                        {editError && (
                                          <span className="text-xs text-red-500">
                                            {editError}
                                          </span>
                                        )}
                                      </form>
                                    ) : (
                                      <button
                                        key={punch.id}
                                        type="button"
                                        onClick={() =>
                                          startEditing(punch, dayKey)
                                        }
                                        disabled={!canEdit}
                                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
                                          canEdit
                                            ? "bg-zinc-100 text-zinc-700 hover:bg-blue-50 hover:text-blue-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
                                        }`}
                                      >
                                        {PUNCH_TYPE_LABEL[
                                          punch.punchType as PunchTypeValue
                                        ] ?? punch.punchType}{" "}
                                        {format(
                                          parseISO(punch.roundedTime),
                                          "h:mm a"
                                        )}
                                        {canEdit && (
                                          <Pencil className="h-2.5 w-2.5" />
                                        )}
                                      </button>
                                    )
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>

                {/* ── Summary by pay bucket ──────────────────────────── */}
                <div className="border-t border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-zinc-500">
                          Summary
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-zinc-500">
                          Hours
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {(() => {
                        const bucketMap = Object.fromEntries(
                          timecard.overtimeBuckets.map((b) => [
                            b.bucket,
                            b.totalMinutes,
                          ])
                        );
                        const visible = ALL_PAY_BUCKETS.filter(
                          (b) =>
                            b.key === "REG" || (bucketMap[b.key] ?? 0) > 0
                        );
                        const grandTotal = Object.values(bucketMap).reduce(
                          (a, b) => a + b,
                          0
                        );

                        return (
                          <>
                            {visible.map((b) => (
                              <tr key={b.key}>
                                <td
                                  className={`px-4 py-1.5 font-medium ${b.color}`}
                                >
                                  {b.label}
                                </td>
                                <td
                                  className={`px-4 py-1.5 text-right tabular-nums ${b.color}`}
                                >
                                  {minutesToHoursDecimal(
                                    bucketMap[b.key] ?? 0
                                  )}
                                </td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
                              <td className="px-4 py-2 font-bold text-zinc-900 dark:text-white">
                                Total
                              </td>
                              <td className="px-4 py-2 text-right font-bold tabular-nums text-zinc-900 dark:text-white">
                                {minutesToHoursDecimal(grandTotal)}
                              </td>
                            </tr>
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
