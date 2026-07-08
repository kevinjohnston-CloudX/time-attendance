"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  format,
  eachDayOfInterval,
  parseISO,
  isToday,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  isSameMonth,
  isSameDay,
} from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";
import { minutesToHoursDecimal } from "@/lib/utils/duration";
import type { WorkSegment } from "@prisma/client";
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
  toggleMealWaiver,
} from "@/actions/timesheet.actions";
import {
  removePayrollLeaveEntry,
  getLeaveTypesForTimecard,
  saveTimesheetNote,
} from "@/actions/timecard-entry.actions";
import { setSegmentPayCode, setSegmentPayBucket, setAbsentDayPayBucket } from "@/actions/pay-code.actions";
import { AddTimecardEntry } from "@/components/payroll/add-timecard-entry";
import { SegmentTimeline } from "@/components/time/segment-timeline";
import {
  Search,
  ChevronRight,
  ChevronLeft,
  Pencil,
  Plus,
  X,
  Calendar,
  UserCircle,
  StickyNote,
} from "lucide-react";

// ─── Serialized prop types (dates as ISO strings) ────────────────────────────

type EmployeeListItem = {
  timesheetId: string;
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  status: string;
  isActive: boolean;
  totalMinutes: number;
  exceptionTypes: string[];
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
  payBucketOverride: string | null;
  isPaid: boolean;
  leaveRequest?: {
    id: string;
    leaveType: { name: string; category: string };
  } | null;
  payCode?: {
    id: string;
    code: number;
    label: string;
  } | null;
};

type PayCodeOption = {
  id: string;
  code: number;
  label: string;
};

type TimesheetNoteItem = {
  id: string;
  noteDate: string;
  note: string;
  createdById: string;
};

type LeaveTypeOption = {
  id: string;
  name: string;
  category: string;
  isPaid: boolean;
};

type TimecardBucket = {
  bucket: string;
  totalMinutes: number;
};

type TimecardException = {
  id: string;
  exceptionType: string;
  occurredAt: string;
};

type TimecardDetail = {
  timesheetId: string;
  status: string;
  exceptionCount: number;
  exceptions: TimecardException[];
  payPeriod: { startDate: string; endDate: string };
  employee: {
    user: { name: string | null } | null;
    department: { name: string };
    employeeCode: string;
    payRate: number | null;
    payType: string | null;
    ruleSet: { autoDeductMeal: boolean; mealBreakMinutes: number; mealBreakAfterMinutes: number };
  };
  punches: TimecardPunch[];
  segments: TimecardSegment[];
  overtimeBuckets: TimecardBucket[];
  mealWaivers: { id: string; segmentDate: string; reason: string }[];
  notes: TimesheetNoteItem[];
};

type PayFrequencyValue = "WEEKLY" | "BIWEEKLY" | "SEMIMONTHLY" | "MONTHLY";

const PAY_FREQUENCY_LABEL: Record<PayFrequencyValue, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  SEMIMONTHLY: "Semimonthly",
  MONTHLY: "Monthly",
};

interface TimecardViewerProps {
  payPeriods: PayPeriodOption[];
  selectedPayPeriodId: string;
  employees: EmployeeListItem[];
  selectedEmployeeId: string | null;
  timecard: TimecardDetail | null;
  payFrequency: string;
  payCodes: PayCodeOption[];
  customStart?: string | null;
  customEnd?: string | null;
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

// ─── Summary Row Helper ─────────────────────────────────────────────────────

function SummaryRow({
  label,
  reg,
  ot,
  dt,
  total,
  rate,
  isBold,
  className,
}: {
  label: string;
  reg: number;
  ot: number;
  dt: number;
  total: number;
  rate: number | null;
  isBold?: boolean;
  className?: string;
}) {
  const fmt = (m: number) => minutesToHoursDecimal(m);
  const fmtMoney = (v: number) => `$${v.toFixed(2)}`;
  const regPay = rate ? (reg / 60) * rate : 0;
  const otPay = rate ? (ot / 60) * rate * 1.5 : 0;
  const dtPay = rate ? (dt / 60) * rate * 2 : 0;
  const totalPay = regPay + otPay + dtPay;

  const base = isBold
    ? "border-t-2 border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
    : "";
  const text = isBold
    ? "font-bold text-zinc-900 dark:text-white"
    : className ?? "text-zinc-700 dark:text-zinc-300";

  return (
    <tr className={base}>
      <td className={`px-4 py-1.5 ${text}`}>{label}</td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${text}`}>
        {reg > 0 ? fmt(reg) : "—"}
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums ${
          ot > 0
            ? "font-semibold text-amber-600 dark:text-amber-400"
            : text
        }`}
      >
        {ot > 0 ? fmt(ot) : "—"}
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums ${
          dt > 0
            ? "font-semibold text-red-600 dark:text-red-400"
            : text
        }`}
      >
        {dt > 0 ? fmt(dt) : "—"}
      </td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${isBold ? text : "font-semibold text-zinc-900 dark:text-white"}`}>
        {fmt(total)}
      </td>
      {rate !== null && (
        <>
          <td className={`px-3 py-1.5 text-right tabular-nums ${text}`}>
            {fmtMoney(rate)}
          </td>
          <td className={`px-3 py-1.5 text-right tabular-nums ${text}`}>
            {regPay > 0 ? fmtMoney(regPay) : "—"}
          </td>
          <td className={`px-3 py-1.5 text-right tabular-nums ${text}`}>
            {otPay > 0 ? fmtMoney(otPay) : "—"}
          </td>
          <td className={`px-3 py-1.5 text-right tabular-nums ${text}`}>
            {dtPay > 0 ? fmtMoney(dtPay) : "—"}
          </td>
          <td className={`px-3 py-1.5 text-right tabular-nums ${isBold ? text : "font-semibold text-zinc-900 dark:text-white"}`}>
            {fmtMoney(totalPay)}
          </td>
        </>
      )}
    </tr>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TimecardViewer({
  payPeriods,
  selectedPayPeriodId,
  employees,
  selectedEmployeeId,
  timecard,
  payFrequency,
  payCodes,
  customStart,
  customEnd,
}: TimecardViewerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [activeOnly, setActiveOnly] = useState(true);
  const [isPending, startTransition] = useTransition();

  // ── Pay period navigation helpers ─────────────────────────────────────
  const sortedPeriods = [...payPeriods].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  const currentIndex = sortedPeriods.findIndex(
    (pp) => pp.id === selectedPayPeriodId
  );
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < sortedPeriods.length - 1;

  // Find "current" pay period (the one containing today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentPeriod = sortedPeriods.find((pp) => {
    const start = parseUtcDate(pp.startDate);
    const end = parseUtcDate(pp.endDate);
    return today >= start && today <= end;
  });
  const currentPeriodIndex = currentPeriod
    ? sortedPeriods.indexOf(currentPeriod)
    : -1;
  const lastPeriod =
    currentPeriodIndex > 0 ? sortedPeriods[currentPeriodIndex - 1] : null;
  const nextPeriod =
    currentPeriodIndex >= 0 &&
    currentPeriodIndex < sortedPeriods.length - 1
      ? sortedPeriods[currentPeriodIndex + 1]
      : null;

  // Find the pay period that contains a given date
  function findPeriodForDate(date: Date): PayPeriodOption | undefined {
    return sortedPeriods.find((pp) => {
      const start = parseUtcDate(pp.startDate);
      const end = parseUtcDate(pp.endDate);
      return date >= start && date <= end;
    });
  }

  function handleCalendarDateSelect(date: Date) {
    if (!rangeStart || rangeEnd) {
      // Start a new selection
      setRangeStart(date);
      setRangeEnd(null);
      setHoverDate(null);
    } else if (isSameDay(date, rangeStart)) {
      // Single-day range — treat same day click as a one-day range
      setRangeEnd(date);
      navigateCustomRange(rangeStart, date);
    } else if (date < rangeStart) {
      // Clicked before start — restart
      setRangeStart(date);
      setRangeEnd(null);
      setHoverDate(null);
    } else {
      // Valid end date — complete selection
      setRangeEnd(date);
      navigateCustomRange(rangeStart, date);
    }
  }

  // Determine which quick-select label applies to the current selection
  function getQuickSelectValue(): string {
    if (currentPeriod && selectedPayPeriodId === currentPeriod.id)
      return "current";
    if (lastPeriod && selectedPayPeriodId === lastPeriod.id) return "last";
    if (nextPeriod && selectedPayPeriodId === nextPeriod.id) return "next";
    return selectedPayPeriodId;
  }

  // Calendar picker
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Close calendar when clicking outside
  useEffect(() => {
    if (!showCalendar) return;
    function handleClick(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCalendar]);

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
  const [actionError, setActionError] = useState<string | null>(null);

  // Meal waiver
  const [waiverDay, setWaiverDay] = useState<string | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverError, setWaiverError] = useState<string | null>(null);

  // Add entry
  const [addEntryDay, setAddEntryDay] = useState<string | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);

  // Notes
  const [noteDay, setNoteDay] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  // Summary
  const [summaryGroupBy, setSummaryGroupBy] = useState<
    "total" | "week" | "paycode"
  >("total");

  // Employee pay rate for summary calculations
  const rate = timecard?.employee.payRate ?? null;

  // Reset state when employee changes
  useEffect(() => {
    setExpandedDays(new Set());
    setEditingPunchId(null);
    setEditError(null);
    setShowRejectForm(false);
    setRejectNote("");
    setWaiverDay(null);
    setWaiverReason("");
    setWaiverError(null);
    setAddEntryDay(null);
    setNoteDay(null);
    setNoteText("");
  }, [timecard?.timesheetId]);

  const canEdit =
    timecard &&
    timecard.status !== "LOCKED" &&
    timecard.status !== "PAYROLL_APPROVED";

  const filteredEmployees = employees.filter((emp) => {
    // Text search
    const q = search.toLowerCase();
    const matchesSearch =
      emp.name.toLowerCase().includes(q) ||
      emp.employeeCode.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q);
    if (!matchesSearch) return false;

    // Active only filter
    if (activeOnly && !emp.isActive) return false;

    // Status / exception filter
    if (statusFilter === "ALL") return true;
    if (statusFilter === "ALL_EXCLUDING_OPEN") return emp.status !== "OPEN";
    // Status-based filters
    const statusFilters = [
      "OPEN",
      "SUBMITTED",
      "SUP_APPROVED",
      "PAYROLL_APPROVED",
      "LOCKED",
    ];
    if (statusFilters.includes(statusFilter)) return emp.status === statusFilter;
    // Exception-based filters
    return emp.exceptionTypes.includes(statusFilter);
  });

  function navigate(payPeriodId: string, employeeId?: string | null) {
    const params = new URLSearchParams({ payPeriodId });
    if (employeeId) params.set("employeeId", employeeId);
    router.push(`/payroll/timecards?${params.toString()}`);
  }

  function navigateCustomRange(start: Date, end: Date) {
    const params = new URLSearchParams();
    params.set("customStart", format(start, "yyyy-MM-dd"));
    params.set("customEnd", format(end, "yyyy-MM-dd"));
    if (selectedEmployeeId) params.set("employeeId", selectedEmployeeId);
    router.push(`/payroll/timecards?${params.toString()}`);
    setShowCalendar(false);
  }

  // Build daily data from timecard — use custom range if provided, else full pay period
  const customStartDate = customStart ? new Date(customStart + "T12:00:00") : null;
  const customEndDate = customEnd ? new Date(customEnd + "T12:00:00") : null;
  const days =
    timecard &&
    eachDayOfInterval({
      start: customStartDate ?? parseUtcDate(timecard.payPeriod.startDate),
      end: customEndDate ?? parseUtcDate(timecard.payPeriod.endDate),
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

  async function handleOpenAddEntry(dayStr: string) {
    setAddEntryDay(dayStr);
    // Fetch leave types lazily once
    if (leaveTypes.length === 0) {
      const result = await getLeaveTypesForTimecard({});
      if (result.success && result.data) {
        setLeaveTypes(result.data as LeaveTypeOption[]);
      }
    }
  }

  function handleRemoveLeave(leaveRequestId: string) {
    startTransition(async () => {
      await removePayrollLeaveEntry({ leaveRequestId });
      router.refresh();
    });
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
    setActionError(null);
    startTransition(async () => {
      const action =
        timecard.status === "SUP_APPROVED"
          ? payrollApproveTimesheet
          : approveTimesheet;
      const result = await action({ timesheetId: timecard.timesheetId });
      if (!result.success) setActionError(result.error);
      else router.refresh();
    });
  }

  function handleReject(e: React.FormEvent) {
    e.preventDefault();
    if (!timecard) return;
    setActionError(null);
    startTransition(async () => {
      const result = await rejectTimesheet({
        timesheetId: timecard.timesheetId,
        note: rejectNote,
      });
      if (!result.success) {
        setActionError(result.error);
        return;
      }
      setShowRejectForm(false);
      setRejectNote("");
      router.refresh();
    });
  }

  function handleToggleWaiver(segmentDate: string, isCurrentlyWaived: boolean) {
    if (!timecard) return;
    setWaiverError(null);
    startTransition(async () => {
      const result = await toggleMealWaiver({
        timesheetId: timecard.timesheetId,
        segmentDate,
        reason: isCurrentlyWaived ? "" : waiverReason,
      });
      if (!result.success) {
        setWaiverError((result as { success: false; error: string }).error);
        return;
      }
      setWaiverDay(null);
      setWaiverReason("");
      router.refresh();
    });
  }

  function handlePayCodeChange(segmentId: string, payCodeId: string) {
    startTransition(async () => {
      await setSegmentPayCode({
        segmentId,
        payCodeId: payCodeId || null,
      });
      router.refresh();
    });
  }

  function handlePayBucketChange(segmentId: string, payBucket: string) {
    startTransition(async () => {
      await setSegmentPayBucket({ segmentId, payBucket });
      router.refresh();
    });
  }

  function handleAbsentPayBucketChange(timesheetId: string, segmentDate: string, payBucket: string) {
    startTransition(async () => {
      await setAbsentDayPayBucket({ timesheetId, segmentDate, payBucket: payBucket || null });
      router.refresh();
    });
  }

  function handleOpenNote(dayStr: string) {
    const existing = timecard?.notes.find((n) => n.noteDate === dayStr);
    setNoteDay(dayStr);
    setNoteText(existing?.note ?? "");
  }

  function handleSaveNote() {
    if (!timecard || !noteDay) return;
    startTransition(async () => {
      await saveTimesheetNote({
        timesheetId: timecard.timesheetId,
        noteDate: noteDay,
        note: noteText,
      });
      setNoteDay(null);
      setNoteText("");
      router.refresh();
    });
  }

  // Column count for colSpan on expanded rows
  // Base: chevron + date + notes-icon + in + out + paycode + reg + ot + dt + total = 10
  // +1 if pay codes (DB entity) column exists
  const colCount = 10 + (payCodes.length > 0 ? 1 : 0);

  const canApprove =
    timecard &&
    (timecard.status === "SUBMITTED" || timecard.status === "SUP_APPROVED");
  const canReject =
    timecard &&
    (timecard.status === "SUBMITTED" || timecard.status === "SUP_APPROVED");

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      {/* ── Top bar: pay period filter bar ─────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Pay frequency indicator */}
        <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          {PAY_FREQUENCY_LABEL[payFrequency as PayFrequencyValue] ??
            payFrequency}
        </span>

        {/* Quick-select dropdown */}
        <select
          value={getQuickSelectValue()}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "current" && currentPeriod)
              navigate(currentPeriod.id);
            else if (val === "last" && lastPeriod)
              navigate(lastPeriod.id);
            else if (val === "next" && nextPeriod)
              navigate(nextPeriod.id);
            else navigate(val);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          {currentPeriod && (
            <option value="current">Current Pay Period</option>
          )}
          {lastPeriod && (
            <option value="last">Last Pay Period</option>
          )}
          {nextPeriod && (
            <option value="next">Next Pay Period</option>
          )}
          <optgroup label="All Pay Periods">
            {sortedPeriods
              .slice()
              .reverse()
              .map((pp) => (
                <option key={pp.id} value={pp.id}>
                  {format(parseUtcDate(pp.startDate), "MM/dd/yyyy")} –{" "}
                  {format(parseUtcDate(pp.endDate), "MM/dd/yyyy")}
                </option>
              ))}
          </optgroup>
        </select>

        {/* Previous / Next arrows with date display */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() =>
              hasPrev && navigate(sortedPeriods[currentIndex - 1].id)
            }
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Previous pay period"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[260px] text-center text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
            {(() => {
              const sel = sortedPeriods[currentIndex];
              if (!sel) return "—";
              const s = parseUtcDate(sel.startDate);
              const e = parseUtcDate(sel.endDate);
              return `${format(s, "MM/dd/yyyy")} (${format(s, "EEE")}) – ${format(e, "MM/dd/yyyy")} (${format(e, "EEE")})`;
            })()}
          </span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() =>
              hasNext && navigate(sortedPeriods[currentIndex + 1].id)
            }
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Next pay period"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Calendar picker */}
        <div className="relative" ref={calendarRef}>
          <button
            type="button"
            onClick={() => {
              if (!showCalendar) {
                setRangeStart(customStart ? new Date(customStart + "T12:00:00") : null);
                setRangeEnd(customEnd ? new Date(customEnd + "T12:00:00") : null);
                setHoverDate(null);
                const initDate = customStart
                  ? new Date(customStart + "T12:00:00")
                  : (sortedPeriods[currentIndex] ? parseUtcDate(sortedPeriods[currentIndex].startDate) : new Date());
                setCalendarMonth(initDate);
              }
              setShowCalendar(!showCalendar);
            }}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Pick a date"
          >
            <Calendar className="h-4 w-4" />
          </button>
          {showCalendar && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              {/* Month navigation */}
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
              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 gap-0">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div
                    key={d}
                    className="py-1 text-center text-xs font-medium text-zinc-400"
                  >
                    {d}
                  </div>
                ))}
                {/* Calendar days */}
                {(() => {
                  const monthStart = startOfMonth(calendarMonth);
                  const monthEnd = endOfMonth(calendarMonth);
                  const calStart = startOfWeek(monthStart);
                  const calEnd = endOfWeek(monthEnd);
                  const calDays = eachDayOfInterval({
                    start: calStart,
                    end: calEnd,
                  });
                  const effectiveEnd = rangeEnd ?? hoverDate;

                  return calDays.map((d) => {
                    const inMonth = isSameMonth(d, calendarMonth);
                    const isNow = isSameDay(d, new Date());
                    const isStart = !!rangeStart && isSameDay(d, rangeStart);
                    const isEnd = !!rangeEnd && isSameDay(d, rangeEnd);
                    const isEndpoint = isStart || isEnd;
                    const inRange =
                      !!rangeStart &&
                      !!effectiveEnd &&
                      d > rangeStart &&
                      d < effectiveEnd;

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
                          isNow && !isEndpoint && !inRange
                            ? "ring-1 ring-blue-400"
                            : ""
                        } ${
                          !isEndpoint ? "hover:bg-zinc-100 dark:hover:bg-zinc-700" : ""
                        }`}
                      >
                        {d.getDate()}
                      </button>
                    );
                  });
                })()}
              </div>
              {/* Footer buttons */}
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
                      const params = new URLSearchParams();
                      if (selectedEmployeeId) params.set("employeeId", selectedEmployeeId);
                      const fallbackId = sortedPeriods[currentIndex]?.id;
                      if (fallbackId) params.set("payPeriodId", fallbackId);
                      router.push(`/payroll/timecards?${params.toString()}`);
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
          {employees.length} employee{employees.length !== 1 && "s"}
        </span>
      </div>

      {/* ── Split pane ───────────────────────────────────────────────── */}
      <div className="grid h-[calc(100vh-14rem)] grid-cols-[260px_1fr]">
        {/* ── Left: employee list ─────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          <div className="space-y-2 border-b border-zinc-200 p-2.5 dark:border-zinc-800">
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
            {/* Status / Exception filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            >
              <optgroup label="Status">
                <option value="ALL">All Timesheets</option>
                <option value="ALL_EXCLUDING_OPEN">Excluding Open</option>
                <option value="OPEN">Open</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="SUP_APPROVED">Supervisor Approved</option>
                <option value="PAYROLL_APPROVED">Payroll Approved</option>
                <option value="LOCKED">Locked</option>
              </optgroup>
              <optgroup label="Exceptions">
                <option value="MISSING_PUNCH">Missing Punch</option>
                <option value="LONG_SHIFT">Long Shift</option>
                <option value="SHORT_BREAK">Short Break</option>
                <option value="MISSED_MEAL">Missed Meal</option>
                <option value="UNSCHEDULED_OT">Unscheduled OT</option>
                <option value="CONSECUTIVE_DAYS">Consecutive Days</option>
              </optgroup>
            </select>
            {/* Active only toggle */}
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-600"
              />
              Active only
            </label>
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
        <div className="flex min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950">
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
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-base font-bold text-zinc-900 dark:text-white">
                        {timecard.employee.user?.name ??
                          timecard.employee.employeeCode}
                      </h2>
                      {selectedEmployeeId && (
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/admin/employees/${selectedEmployeeId}`
                            )
                          }
                          title="Go to employee profile"
                          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-blue-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-blue-400"
                        >
                          <UserCircle className="h-4 w-4" />
                        </button>
                      )}
                    </div>
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
                  {actionError && <p className="text-xs text-red-500">{actionError}</p>}
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
                  <thead className="sticky top-0 border-b border-zinc-200 bg-[#2492c7] dark:border-zinc-700">
                    <tr>
                      <th className="w-7 pl-2 pr-0 py-2.5" />
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Date</th>
                      {payCodes.length > 0 && (
                        <th className="px-2 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Code</th>
                      )}
                      <th className="w-7 px-1 py-2.5" />
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">In</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Out</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Pay Code</th>
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
                      // Show a week separator before each Monday (except the very first row)
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

                      const clockIns = dayPunches.filter(
                        (p) => p.punchType === "CLOCK_IN"
                      );
                      const clockOuts = dayPunches.filter(
                        (p) => p.punchType === "CLOCK_OUT"
                      );
                      const firstIn = clockIns[0];
                      const lastOut = clockOuts[clockOuts.length - 1];

                      const leaveSegments = daySegments.filter(
                        (s) => s.segmentType === "LEAVE"
                      );

                      const hasActivity =
                        dayPunches.length > 0 || daySegments.length > 0;

                      // Exception-based highlighting
                      const dayStr = format(day, "yyyy-MM-dd");
                      const dayExceptions = timecard
                        ? timecard.exceptions.filter(
                            (e) =>
                              format(
                                parseISO(e.occurredAt),
                                "yyyy-MM-dd"
                              ) === dayStr
                          )
                        : [];
                      const hasMissingPunch = dayExceptions.some(
                        (e) => e.exceptionType === "MISSING_PUNCH"
                      );
                      // Consider a day "absent" if it's a weekday, not today,
                      // past, has no punches and no leave segments
                      const isPast = day < today;
                      const isAbsent =
                        !isWeekend &&
                        !isTodayRow &&
                        isPast &&
                        dayPunches.length === 0 &&
                        leaveSegments.length === 0 &&
                        daySegments.length === 0;

                      return (
                        <>
                          {/* Week separator */}
                          {showWeekSeparator && (
                            <tr key={`${dayKey}-sep`} aria-hidden>
                              <td colSpan={colCount} className="h-0 border-t-2 border-zinc-300 dark:border-zinc-600 p-0" />
                            </tr>
                          )}

                          {/* Day summary row */}
                          <tr
                            key={dayKey}
                            className={`border-b border-zinc-200 dark:border-zinc-700 transition-colors ${
                              isAbsent
                                ? "bg-red-100 dark:bg-red-950/40"
                                : hasMissingPunch
                                  ? "bg-amber-50 dark:bg-amber-950/30"
                                  : isTodayRow
                                    ? "bg-blue-50/60 dark:bg-blue-950/20"
                                    : isWeekend
                                      ? "bg-zinc-50/70 dark:bg-zinc-900/40"
                                      : hasActivity
                                        ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                                        : "hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20"
                            } ${hasActivity ? "cursor-pointer" : ""}`}
                            onClick={
                              hasActivity
                                ? () => toggleDay(dayKey)
                                : undefined
                            }
                          >
                            {/* Expand chevron / activity indicator */}
                            <td className="w-7 pl-2 pr-0 text-center">
                              {hasActivity ? (
                                <ChevronRight
                                  className={`inline h-3.5 w-3.5 text-zinc-400 transition-transform ${
                                    isExpanded ? "rotate-90" : ""
                                  }`}
                                />
                              ) : isTodayRow ? (
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                              ) : null}
                            </td>

                            {/* Date (EEE MM/dd/yyyy) */}
                            <td className={`px-3 py-2.5 text-sm font-medium tabular-nums ${
                              isAbsent
                                ? "text-red-800 dark:text-red-300"
                                : isTodayRow
                                  ? "text-blue-700 dark:text-blue-400"
                                  : isWeekend
                                    ? "text-zinc-400 dark:text-zinc-500"
                                    : "text-zinc-700 dark:text-zinc-300"
                            }`}>
                              <span className="inline-flex items-center gap-1">
                                <span className={`${isWeekend ? "" : "font-semibold"} mr-0.5`}>
                                  {format(day, "EEE")}
                                </span>
                                {format(day, "MM/dd/yyyy")}
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenAddEntry(format(day, "yyyy-MM-dd"));
                                    }}
                                    title="Add time or leave"
                                    className="rounded p-0.5 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                )}
                              </span>
                            </td>

                            {/* Pay code */}
                            {payCodes.length > 0 && (
                              <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                                {(() => {
                                  // Find the primary work segment for this day to get/set pay code
                                  const workSeg = daySegments.find(
                                    (s) => s.segmentType === "WORK" || s.segmentType === "LEAVE"
                                  );
                                  if (!workSeg) return null;
                                  return canEdit ? (
                                    <select
                                      value={workSeg.payCode?.id ?? ""}
                                      onChange={(e) =>
                                        handlePayCodeChange(workSeg.id, e.target.value)
                                      }
                                      className="w-24 rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                    >
                                      <option value="">—</option>
                                      {payCodes.map((pc) => (
                                        <option key={pc.id} value={pc.id}>
                                          {pc.code}[{pc.label}]
                                        </option>
                                      ))}
                                    </select>
                                  ) : workSeg.payCode ? (
                                    <span className="text-xs text-zinc-500">
                                      {workSeg.payCode.code}[{workSeg.payCode.label}]
                                    </span>
                                  ) : null;
                                })()}
                              </td>
                            )}

                            {/* Notes icon */}
                            <td className="w-7 px-1 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                              {(() => {
                                const dayStr = format(day, "yyyy-MM-dd");
                                const existingNote = timecard?.notes.find(
                                  (n) => n.noteDate === dayStr
                                );
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenNote(dayStr)}
                                    title={existingNote ? existingNote.note : "Add note"}
                                    className={`rounded p-0.5 ${
                                      existingNote
                                        ? "text-amber-500 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                        : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                                    }`}
                                  >
                                    <StickyNote className="h-4 w-4" />
                                  </button>
                                );
                              })()}
                            </td>

                            {/* In time */}
                            <td className={`px-3 py-2.5 font-mono text-sm ${
                              isAbsent
                                ? "text-red-700 dark:text-red-400"
                                : hasMissingPunch
                                  ? "text-amber-700 dark:text-amber-400"
                                  : "text-zinc-700 dark:text-zinc-300"
                            }`}>
                              {isAbsent ? (
                                <span className="font-sans text-xs font-semibold">
                                  Absent
                                </span>
                              ) : firstIn ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditing(firstIn, dayKey);
                                  }}
                                  disabled={!canEdit}
                                  className={
                                    canEdit
                                      ? "rounded px-1 py-0.5 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                                      : ""
                                  }
                                >
                                  {format(parseISO(firstIn.roundedTime), "h:mm a")}
                                </button>
                              ) : leaveSegments.length > 0 ? (
                                <span className="flex flex-wrap gap-1">
                                  {leaveSegments.map((seg) => (
                                    <span
                                      key={seg.id}
                                      className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                                    >
                                      {seg.leaveRequest?.leaveType.name ?? PAY_BUCKET_LABEL[seg.payBucket as PayBucketValue] ?? seg.payBucket}
                                    </span>
                                  ))}
                                </span>
                              ) : hasActivity ? (
                                <span className="text-zinc-400">—</span>
                              ) : null}
                            </td>

                            {/* Out time */}
                            <td className="px-3 py-2.5 font-mono text-sm text-zinc-700 dark:text-zinc-300">
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
                                      ? "rounded px-1 py-0.5 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                                      : ""
                                  }
                                >
                                  {format(parseISO(lastOut.roundedTime), "h:mm a")}
                                </button>
                              ) : null}
                            </td>

                            {/* Pay Code bucket dropdown */}
                            <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                              {(() => {
                                if (isAbsent && timecard) {
                                  const dayStr = format(day, "yyyy-MM-dd");
                                  return canEdit ? (
                                    <select
                                      value=""
                                      onChange={(e) =>
                                        handleAbsentPayBucketChange(timecard.timesheetId, dayStr, e.target.value)
                                      }
                                      className="w-28 rounded border border-red-300 bg-white px-1 py-0.5 text-xs text-red-800 focus:outline-none dark:border-red-800 dark:bg-zinc-900 dark:text-red-300"
                                    >
                                      <option value="">—</option>
                                      {ALL_PAY_BUCKETS.filter((b) => !["REG", "OT", "DT"].includes(b.key)).map((bucket) => (
                                        <option key={bucket.key} value={bucket.key}>
                                          {bucket.label}
                                        </option>
                                      ))}
                                    </select>
                                  ) : null;
                                }
                                const isAbsentMarker = (s: { segmentType: string; durationMinutes: number }) =>
                                  s.segmentType === "LEAVE" && s.durationMinutes === 0;
                                const workSeg = daySegments.find(
                                  (s) => s.segmentType === "WORK" || isAbsentMarker(s)
                                );
                                if (!workSeg) return null;
                                const isMarker = isAbsentMarker(workSeg);
                                const dayStr = format(day, "yyyy-MM-dd");
                                // Absent markers: selection lives in payBucket; work segments: override lives in payBucketOverride
                                const dropdownValue = isMarker ? workSeg.payBucket : (workSeg.payBucketOverride ?? "");
                                const manualBuckets = ALL_PAY_BUCKETS.filter((b) => !["REG", "OT", "DT"].includes(b.key));
                                return canEdit ? (
                                  <select
                                    value={dropdownValue}
                                    onChange={(e) => {
                                      if (isMarker && timecard) {
                                        handleAbsentPayBucketChange(timecard.timesheetId, dayStr, e.target.value);
                                      } else {
                                        handlePayBucketChange(workSeg.id, e.target.value);
                                      }
                                    }}
                                    className="w-28 rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                  >
                                    <option value="">—</option>
                                    {manualBuckets.map((bucket) => (
                                      <option key={bucket.key} value={bucket.key}>
                                        {bucket.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-xs text-zinc-500">
                                    {dropdownValue
                                      ? (PAY_BUCKET_LABEL[dropdownValue as PayBucketValue] ?? dropdownValue)
                                      : "—"}
                                  </span>
                                );
                              })()}
                            </td>

                            {/* Reg */}
                            <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${
                              isAbsent
                                ? "text-red-400 dark:text-red-700"
                                : reg > 0
                                  ? "text-zinc-700 dark:text-zinc-300"
                                  : "text-zinc-300 dark:text-zinc-700"
                            }`}>
                              {isAbsent ? "0.00" : reg > 0 ? minutesToHoursDecimal(reg) : "—"}
                            </td>

                            {/* OT */}
                            <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${
                              isAbsent
                                ? "text-red-400 dark:text-red-700"
                                : ot > 0
                                  ? "font-semibold text-amber-600 dark:text-amber-400"
                                  : "text-zinc-300 dark:text-zinc-700"
                            }`}>
                              {ot > 0 ? minutesToHoursDecimal(ot) : "—"}
                            </td>

                            {/* DT */}
                            <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${
                              isAbsent
                                ? "text-red-400 dark:text-red-700"
                                : dt > 0
                                  ? "font-semibold text-red-600 dark:text-red-400"
                                  : "text-zinc-300 dark:text-zinc-700"
                            }`}>
                              {dt > 0 ? minutesToHoursDecimal(dt) : "—"}
                            </td>

                            {/* Total */}
                            <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${
                              isAbsent
                                ? "font-bold text-red-800 dark:text-red-300"
                                : dailyTotal > 0
                                  ? "font-bold text-zinc-900 dark:text-white"
                                  : "text-zinc-300 dark:text-zinc-700"
                            }`}>
                              {isAbsent ? "0.00" : dailyTotal > 0 ? minutesToHoursDecimal(dailyTotal) : "—"}
                            </td>
                          </tr>

                          {/* Add entry form row */}
                          {addEntryDay === format(day, "yyyy-MM-dd") && (
                            <tr key={`${dayKey}-add`}>
                              <td colSpan={colCount} className="px-4 py-2">
                                <AddTimecardEntry
                                  timesheetId={timecard.timesheetId}
                                  date={format(day, "yyyy-MM-dd")}
                                  leaveTypes={leaveTypes}
                                  onClose={() => setAddEntryDay(null)}
                                  onSuccess={() => {
                                    setAddEntryDay(null);
                                    router.refresh();
                                  }}
                                />
                              </td>
                            </tr>
                          )}

                          {/* Note edit row */}
                          {noteDay === format(day, "yyyy-MM-dd") && (
                            <tr key={`${dayKey}-note`}>
                              <td colSpan={colCount} className="px-5 py-2">
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
                                  <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                  <div className="flex-1">
                                    <textarea
                                      value={noteText}
                                      onChange={(e) => setNoteText(e.target.value)}
                                      placeholder="Add a note for this date…"
                                      rows={2}
                                      autoFocus
                                      className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                                    />
                                    <div className="mt-1.5 flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={handleSaveNote}
                                        disabled={isPending}
                                        className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                                      >
                                        {isPending ? "Saving…" : "Save Note"}
                                      </button>
                                      {noteText.trim() === "" && timecard?.notes.find((n) => n.noteDate === noteDay) && (
                                        <span className="text-xs text-zinc-400">
                                          Saving empty will delete the note
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setNoteDay(null);
                                          setNoteText("");
                                        }}
                                        className="text-xs text-zinc-500 hover:text-zinc-700"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}

                          {/* Expanded punch detail row */}
                          {isExpanded && hasActivity && (
                            <tr
                              key={`${dayKey}-detail`}
                              className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/40"
                            >
                              <td colSpan={colCount} className="px-5 py-2">
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

                                {/* ── Leave segments ─────────────────────────── */}
                                {leaveSegments.length > 0 && (
                                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                                    <span className="text-xs text-zinc-500">Leave:</span>
                                    {leaveSegments.map((seg) => (
                                      <span
                                        key={seg.id}
                                        className="inline-flex items-center gap-1 rounded-full bg-violet-100 pl-2 pr-1 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                                      >
                                        {seg.leaveRequest?.leaveType.name ?? PAY_BUCKET_LABEL[seg.payBucket as PayBucketValue] ?? seg.payBucket}
                                        {" "}
                                        ({minutesToHoursDecimal(seg.durationMinutes)}h)
                                        {canEdit && seg.leaveRequest?.id && (
                                          <button
                                            type="button"
                                            disabled={isPending}
                                            onClick={() => handleRemoveLeave(seg.leaveRequest!.id)}
                                            className="ml-0.5 rounded-full p-0.5 hover:bg-violet-200 dark:hover:bg-violet-800 disabled:opacity-50"
                                            title="Remove this leave entry"
                                          >
                                            <X className="h-2.5 w-2.5" />
                                          </button>
                                        )}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* ── Meal waiver section (NJ auto-deduct only) ── */}
                                {(() => {
                                  if (!timecard.employee.ruleSet.autoDeductMeal) return null;
                                  const dayStr = format(day, "yyyy-MM-dd");
                                  const rawWorkMins = daySegments
                                    .filter((s) => s.segmentType === "WORK")
                                    .reduce((a, s) => a + s.durationMinutes, 0);
                                  const mealSeg = daySegments.find((s) => s.segmentType === "MEAL");
                                  const totalWorkForThreshold = rawWorkMins + (mealSeg?.durationMinutes ?? 0);
                                  if (totalWorkForThreshold <= timecard.employee.ruleSet.mealBreakAfterMinutes) return null;

                                  const waiver = timecard.mealWaivers.find((w) => w.segmentDate === dayStr);
                                  const isWaiverDay = waiverDay === dayStr;

                                  return (
                                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                                      <span className="text-xs text-zinc-500">Meal deduction:</span>
                                      {waiver ? (
                                        <>
                                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                            Waived — {waiver.reason}
                                          </span>
                                          {canEdit && (
                                            <button
                                              type="button"
                                              disabled={isPending}
                                              onClick={() => handleToggleWaiver(dayStr, true)}
                                              className="text-xs text-zinc-400 underline hover:text-red-500 disabled:opacity-50"
                                            >
                                              {isPending ? "Removing…" : "Remove waiver"}
                                            </button>
                                          )}
                                        </>
                                      ) : isWaiverDay ? (
                                        <div className="flex items-center gap-2">
                                          <input
                                            value={waiverReason}
                                            onChange={(e) => setWaiverReason(e.target.value)}
                                            placeholder="Reason (e.g. no lunch taken)…"
                                            autoFocus
                                            className="w-56 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                                          />
                                          <button
                                            type="button"
                                            disabled={isPending || !waiverReason.trim()}
                                            onClick={() => handleToggleWaiver(dayStr, false)}
                                            className="rounded bg-amber-500 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                                          >
                                            {isPending ? "Saving…" : "Confirm waiver"}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => { setWaiverDay(null); setWaiverReason(""); }}
                                            className="text-xs text-zinc-400 hover:text-zinc-600"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      ) : (
                                        canEdit && (
                                          <button
                                            type="button"
                                            onClick={() => { setWaiverDay(dayStr); setWaiverReason(""); }}
                                            className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:bg-amber-50 hover:text-amber-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-amber-900/20 dark:hover:text-amber-300"
                                          >
                                            Waive meal
                                          </button>
                                        )
                                      )}
                                      {waiverError && isWaiverDay && (
                                        <span className="text-xs text-red-500">{waiverError}</span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>

                {/* ── Color Legend ──────────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-4 border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
                  <span className="text-xs font-medium text-zinc-400">Legend:</span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="inline-block h-3 w-3 rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" />
                    Missed Punch
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="inline-block h-3 w-3 rounded border border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950/40" />
                    Absent
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="inline-block h-3 w-3 rounded border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/20" />
                    Today
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="inline-block h-3 w-3 rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40" />
                    Weekend
                  </span>
                </div>

                {/* ── Summary with Group By ──────────────────────────── */}
                <div className="border-t border-zinc-200 dark:border-zinc-800">
                  {/* Summary header with Group By selector */}
                  <div className="flex items-center justify-between bg-zinc-50 px-4 py-2 dark:bg-zinc-900">
                    <span className="text-sm font-medium text-zinc-500">
                      Timesheet Summary
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-zinc-400">Group By</label>
                      <select
                        value={summaryGroupBy}
                        onChange={(e) =>
                          setSummaryGroupBy(
                            e.target.value as "total" | "week" | "paycode"
                          )
                        }
                        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                      >
                        <option value="total">Total</option>
                        <option value="week">Week</option>
                        {payCodes.length > 0 && (
                          <option value="paycode">Pay Code</option>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Summary table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/50">
                        <tr>
                          <th className="px-4 py-1.5 text-left text-xs font-medium text-zinc-500">
                            {summaryGroupBy === "week"
                              ? "Week"
                              : summaryGroupBy === "paycode"
                                ? "Pay Code"
                                : "Category"}
                          </th>
                          <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                            Reg Hrs
                          </th>
                          <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                            OT
                          </th>
                          <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                            DT
                          </th>
                          <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                            Total Hrs
                          </th>
                          {rate !== null && (
                            <>
                              <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                                Rate
                              </th>
                              <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                                Reg Pay
                              </th>
                              <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                                OT Pay
                              </th>
                              <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                                DT Pay
                              </th>
                              <th className="px-3 py-1.5 text-right text-xs font-medium text-zinc-500">
                                Total Pay
                              </th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {(() => {
                          const bucketMap: Record<string, number> =
                            Object.fromEntries(
                              timecard.overtimeBuckets.map((b) => [
                                b.bucket,
                                b.totalMinutes,
                              ])
                            );

                          if (summaryGroupBy === "total") {
                            const reg = bucketMap["REG"] ?? 0;
                            const ot = bucketMap["OT"] ?? 0;
                            const dt = bucketMap["DT"] ?? 0;
                            const total = Object.values(bucketMap).reduce(
                              (a, b) => a + b,
                              0
                            );
                            // Also show non-REG/OT/DT buckets
                            const otherBuckets = ALL_PAY_BUCKETS.filter(
                              (b) =>
                                !["REG", "OT", "DT"].includes(b.key) &&
                                (bucketMap[b.key] ?? 0) > 0
                            );

                            return (
                              <>
                                {otherBuckets.map((b) => (
                                  <SummaryRow
                                    key={b.key}
                                    label={b.label}
                                    reg={0}
                                    ot={0}
                                    dt={0}
                                    total={bucketMap[b.key] ?? 0}
                                    rate={rate}
                                    className={b.color}
                                  />
                                ))}
                                <SummaryRow
                                  label="Totals"
                                  reg={reg}
                                  ot={ot}
                                  dt={dt}
                                  total={total}
                                  rate={rate}
                                  isBold
                                />
                              </>
                            );
                          }

                          if (summaryGroupBy === "week") {
                            // Split by week within the pay period
                            const ppStart = parseUtcDate(
                              timecard.payPeriod.startDate
                            );
                            const ppEnd = parseUtcDate(
                              timecard.payPeriod.endDate
                            );
                            const weeks: {
                              label: string;
                              start: Date;
                              end: Date;
                            }[] = [];
                            let wStart = ppStart;
                            while (wStart <= ppEnd) {
                              const wEnd = new Date(
                                Math.min(
                                  wStart.getTime() + 6 * 86400000,
                                  ppEnd.getTime()
                                )
                              );
                              weeks.push({
                                label: `${format(wStart, "MM/dd/yyyy")} – ${format(wEnd, "MM/dd/yyyy")}`,
                                start: wStart,
                                end: wEnd,
                              });
                              wStart = new Date(wEnd.getTime() + 86400000);
                            }

                            let grandReg = 0,
                              grandOt = 0,
                              grandDt = 0,
                              grandTotal = 0;

                            return (
                              <>
                                {weeks.map((week) => {
                                  const weekSegs = timecard.segments.filter(
                                    (s) => {
                                      const sd = parseUtcDate(s.segmentDate);
                                      return sd >= week.start && sd <= week.end;
                                    }
                                  );
                                  const weekBuckets: Record<string, number> =
                                    {};
                                  for (const s of weekSegs) {
                                    if (s.isPaid) {
                                      const eb = s.payBucketOverride ?? s.payBucket;
                                      weekBuckets[eb] =
                                        (weekBuckets[eb] ?? 0) +
                                        s.durationMinutes;
                                    }
                                  }
                                  const reg = weekBuckets["REG"] ?? 0;
                                  const ot = weekBuckets["OT"] ?? 0;
                                  const dt = weekBuckets["DT"] ?? 0;
                                  const total = Object.values(
                                    weekBuckets
                                  ).reduce((a, b) => a + b, 0);
                                  grandReg += reg;
                                  grandOt += ot;
                                  grandDt += dt;
                                  grandTotal += total;
                                  return (
                                    <SummaryRow
                                      key={week.label}
                                      label={week.label}
                                      reg={reg}
                                      ot={ot}
                                      dt={dt}
                                      total={total}
                                      rate={rate}
                                    />
                                  );
                                })}
                                <SummaryRow
                                  label="Totals"
                                  reg={grandReg}
                                  ot={grandOt}
                                  dt={grandDt}
                                  total={grandTotal}
                                  rate={rate}
                                  isBold
                                />
                              </>
                            );
                          }

                          // Pay code grouping
                          const byCode: Record<
                            string,
                            { label: string; minutes: number }
                          > = {};
                          for (const seg of timecard.segments) {
                            if (!seg.isPaid) continue;
                            const eb = seg.payBucketOverride ?? seg.payBucket;
                            const key =
                              seg.payCode
                                ? `${seg.payCode.code}[${seg.payCode.label}]`
                                : PAY_BUCKET_LABEL[eb as PayBucketValue] ?? eb;
                            byCode[key] = byCode[key] ?? {
                              label: key,
                              minutes: 0,
                            };
                            byCode[key].minutes += seg.durationMinutes;
                          }
                          const grandTotal = Object.values(byCode).reduce(
                            (a, b) => a + b.minutes,
                            0
                          );

                          return (
                            <>
                              {Object.values(byCode).map((entry) => (
                                <SummaryRow
                                  key={entry.label}
                                  label={entry.label}
                                  reg={0}
                                  ot={0}
                                  dt={0}
                                  total={entry.minutes}
                                  rate={rate}
                                />
                              ))}
                              <SummaryRow
                                label="Totals"
                                reg={0}
                                ot={0}
                                dt={0}
                                total={grandTotal}
                                rate={rate}
                                isBold
                              />
                            </>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
