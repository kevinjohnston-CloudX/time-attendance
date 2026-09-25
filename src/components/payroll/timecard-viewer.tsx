"use client";

import React, { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  format,
  addDays,
  eachDayOfInterval,
  parseISO,
  isToday,
} from "date-fns";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
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
import { correctPunch, deletePunch } from "@/actions/punch.actions";
import {
  approveTimesheet,
  payrollApproveTimesheet,
  rejectTimesheet,
  toggleMealWaiver,
  toggleMealPremiumWaiver,
  authorizeTimecardOt,
  recalculateSegmentsAdmin,
} from "@/actions/timesheet.actions";
import {
  removePayrollLeaveEntry,
  getLeaveTypesForTimecard,
  saveTimesheetNote,
  addManualPunchPair,
  addSingleManualPunch,
  deleteManualPunchPair,
  addManualHoursEntry,
} from "@/actions/timecard-entry.actions";
import { setSegmentPayCode, setSegmentPayBucket, setAbsentDayPayBucket, setAbsentDayPayCode } from "@/actions/pay-code.actions";
import { setDayReasonCode } from "@/actions/reason-code.actions";
import { ensureTimesheet } from "@/actions/timecard.actions";
import { AddTimecardEntry } from "@/components/payroll/add-timecard-entry";
import {
  Search,
  ChevronRight,
  ChevronLeft,
  Pencil,
  Trash2,
  Plus,
  X,
  Calendar,
  CalendarCheck,
  UserCircle,
  StickyNote,
  Check,
  RefreshCw,
} from "lucide-react";

// ─── Serialized prop types (dates as ISO strings) ────────────────────────────

type EmployeeListItem = {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  siteId: string | null;
  siteName: string | null;
  isActive: boolean;
  payType?: string | null;
  // optional period-dependent fields (present when loaded via batch payroll view)
  timesheetId?: string;
  status?: string;
  totalMinutes?: number;
  exceptionTypes?: string[];
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
  source: string;
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
    leaveType: {
      name: string;
      category: string;
      payCode: { id: string; code: number; label: string } | null;
    };
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

type ReasonCodeOption = {
  id: string;
  code: string;
  label: string;
  color?: string | null;
};

type TimesheetNoteItem = {
  id: string;
  noteDate: string;
  note: string;
  createdById: string;
  createdByName: string | null;
  createdAt: string;
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
  otAuthorized: boolean;
  exceptionCount: number;
  exceptions: TimecardException[];
  payPeriod: { startDate: string; endDate: string };
  employee: {
    user: { name: string | null } | null;
    department: { name: string };
    employeeCode: string;
    payRate: number | null;
    payType: string | null;
    shift: { mealConfig: { autoDeduct?: boolean; minMealMinutes?: number; maxMealMinutes?: number; meals?: { workAtLeastHours: number; deductMinutes: number }[] } | null } | null;
    ruleSet: { autoDeductMeal: boolean; mealBreakMinutes: number; mealBreakAfterMinutes: number; overtimeRequiresAuth: boolean; allowTimesheetOtAuth: boolean; defaultPayCodeId: string | null };
  };
  punches: TimecardPunch[];
  segments: TimecardSegment[];
  overtimeBuckets: TimecardBucket[];
  mealWaivers: { id: string; segmentDate: string; reason: string | null }[];
  mealPremiumWaivers: { id: string; segmentDate: string; segmentStart: string }[];
  notes: TimesheetNoteItem[];
  dayReasons: { segmentDate: string; reasonCodeId: string; reasonCode: { id: string; code: string; label: string; color?: string | null } }[];
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
  selectedPeriodId: string | null;
  employees: EmployeeListItem[];
  selectedEmployeeId: string | null;
  timecard: TimecardDetail | null;
  payFrequency: string;
  payCodes: PayCodeOption[];
  reasonCodes: ReasonCodeOption[];
  customStart?: string | null;
  customEnd?: string | null;
  sites: { id: string; name: string }[];
  selectedSiteId: string | null;
  departments: { id: string; name: string }[];
  selectedDepartmentId: string | null;
  userRole: string;
  readOnly?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface PunchPair {
  inPunch: { id: string; punchType: string; roundedTime: string; source: string } | null;
  outPunch: { id: string; punchType: string; roundedTime: string; source: string } | null;
}

function buildPunchPairs(punches: { id: string; punchType: string; roundedTime: string; source: string }[]): PunchPair[] {
  const clocks = punches
    .filter((p) => p.punchType === "CLOCK_IN" || p.punchType === "CLOCK_OUT")
    .sort((a, b) => new Date(a.roundedTime).getTime() - new Date(b.roundedTime).getTime());
  const pairs: PunchPair[] = [];
  let i = 0;
  while (i < clocks.length) {
    if (clocks[i].punchType === "CLOCK_IN") {
      const nextOutOffset = clocks.slice(i + 1).findIndex((p) => p.punchType === "CLOCK_OUT");
      if (nextOutOffset >= 0) {
        pairs.push({ inPunch: clocks[i], outPunch: clocks[i + 1 + nextOutOffset] });
        i = i + 1 + nextOutOffset + 1;
      } else {
        pairs.push({ inPunch: clocks[i], outPunch: null });
        i++;
      }
    } else {
      pairs.push({ inPunch: null, outPunch: clocks[i] });
      i++;
    }
  }
  return pairs.length > 0 ? pairs : [{ inPunch: null, outPunch: null }];
}

/** Parse a loose time string entered by the user into { hours (1–12), minutes }. */
function parseTimeInput(str: string): { hours: number; minutes: number } | null {
  const s = str.trim().replace(/\s/g, "");
  if (!s) return null;
  // "8:30" or "8:00"
  if (s.includes(":")) {
    const [hPart, mPart] = s.split(":");
    const h = parseInt(hPart, 10);
    const m = parseInt(mPart, 10);
    if (!isNaN(h) && !isNaN(m) && h >= 1 && h <= 12 && m >= 0 && m < 60) return { hours: h, minutes: m };
    return null;
  }
  // "830" → 8:30, "1230" → 12:30
  if (/^\d{3,4}$/.test(s)) {
    const m = parseInt(s.slice(-2), 10);
    const h = parseInt(s.slice(0, -2), 10);
    if (h >= 1 && h <= 12 && m >= 0 && m < 60) return { hours: h, minutes: m };
    return null;
  }
  // "8" → 8:00
  if (/^\d{1,2}$/.test(s)) {
    const h = parseInt(s, 10);
    if (h >= 1 && h <= 12) return { hours: h, minutes: 0 };
  }
  return null;
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

// ─── Recalculate button ──────────────────────────────────────────────────────

function RecalculateButton({ timesheetId }: { timesheetId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRecalculate() {
    setError(null);
    startTransition(async () => {
      const result = await recalculateSegmentsAdmin({ timesheetId });
      if (!result.success) {
        setError((result as { success: false; error: string }).error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleRecalculate}
        disabled={isPending}
        title="Recalculate segments and overtime"
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Recalculating…" : "Recalculate"}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

// Buckets that are paid at regular rate (shown in Reg Hrs column in summary)
const PAID_LEAVE_BUCKETS = new Set(["PTO", "SICK", "HOLIDAY", "FMLA", "BEREAVEMENT", "JURY_DUTY", "MILITARY"]);

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

// ─── Inline punch edit cell (Excel-style: blur = save, Escape = cancel) ──────

function InlinePunchEdit({
  timeStr, amPm, error, isPending,
  onTimeChange, onAmPmToggle, onBlurSave, onCancel, onDelete,
}: {
  timeStr: string; amPm: "AM" | "PM"; error: string | null; isPending: boolean;
  onTimeChange: (v: string) => void; onAmPmToggle: () => void;
  onBlurSave: () => void; onCancel: () => void; onDelete?: () => void;
}) {
  const deletingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Refocus the input whenever a validation error appears so the user can correct without re-clicking
  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={timeStr}
          onChange={(e) => onTimeChange(e.target.value)}
          onBlur={() => { if (!deletingRef.current) onBlurSave(); deletingRef.current = false; }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
            if (e.key === "Enter")  { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          }}
          autoFocus
          placeholder="8:30"
          className="w-16 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onAmPmToggle}
          className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs font-medium dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          {amPm}
        </button>
        {onDelete && (
          <button
            type="button"
            disabled={isPending}
            onMouseDown={() => { deletingRef.current = true; }}
            onClick={() => {
              if (!window.confirm("Remove this punch? This cannot be undone.")) {
                deletingRef.current = false;
                return;
              }
              deletingRef.current = false;
              onDelete();
            }}
            className="rounded p-0.5 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/30"
            title="Remove punch"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TimecardViewer({
  payPeriods,
  selectedPeriodId,
  employees,
  selectedEmployeeId,
  timecard,
  payFrequency,
  payCodes,
  reasonCodes,
  customStart,
  customEnd,
  sites,
  selectedSiteId,
  departments,
  selectedDepartmentId,
  userRole,
  readOnly = false,
}: TimecardViewerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [exceptionFilter, setExceptionFilter] = useState("ALL");
  const [payTypeFilter, setPayTypeFilter] = useState("ALL");
  const [activeOnly, setActiveOnly] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [pendingPayCodes, setPendingPayCodes] = useState<Map<string, string>>(new Map());
  const [pendingReasonCodes, setPendingReasonCodes] = useState<Map<string, string>>(new Map());
  const [pendingPunchEdits, setPendingPunchEdits] = useState<Map<string, Date>>(new Map());
  const [pendingNewPunches, setPendingNewPunches] = useState<Array<{ dayKey: string; pairIndex: number; punchType: "CLOCK_IN" | "CLOCK_OUT"; punchDate: Date }>>([]);
  const [pendingWaiverToggles, setPendingWaiverToggles] = useState<Set<string>>(new Set());
  // Map<segmentStart (ISO), segmentDate (yyyy-MM-dd)>
  const [pendingPremiumWaiverToggles, setPendingPremiumWaiverToggles] = useState<Map<string, string>>(new Map());
  const [pendingDeletions, setPendingDeletions] = useState<Array<{ punchIds: string[]; dayKey: string; inTime: string | null; outTime: string | null }>>([]);
  const [pendingHoursEntries, setPendingHoursEntries] = useState<Array<{ dayKey: string; hours: number; payCodeId?: string }>>([]);

  // ── Pay period navigation helpers ─────────────────────────────────────
  const sortedPeriods = [...payPeriods].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  const currentIndex = sortedPeriods.findIndex(
    (pp) => pp.id === selectedPeriodId
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

  // Month/year picker
  const [showCalendar, setShowCalendar] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => {
    const sel = sortedPeriods.find((pp) => pp.id === selectedPeriodId);
    return sel ? parseUtcDate(sel.startDate).getFullYear() : new Date().getFullYear();
  });
  const calendarRef = useRef<HTMLDivElement>(null);

  // All unique "YYYY-MM" keys that have at least one pay period
  const allMonthKeys = [...new Set(
    sortedPeriods.flatMap((pp) => {
      const keys: string[] = [];
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      const cur = new Date(s.getFullYear(), s.getMonth(), 1);
      const end = new Date(e.getFullYear(), e.getMonth(), 1);
      while (cur <= end) {
        keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
        cur.setMonth(cur.getMonth() + 1);
      }
      return keys;
    })
  )].sort();

  const monthsWithPeriods = new Set(
    allMonthKeys
      .filter((k) => k.startsWith(`${pickerYear}-`))
      .map((k) => parseInt(k.slice(5, 7)) - 1)
  );

  const selectedPp = sortedPeriods.find((pp) => pp.id === selectedPeriodId);
  const selectedMonthYear = selectedPp ? parseUtcDate(selectedPp.startDate).getFullYear() : -1;
  const selectedMonthIdx  = selectedPp ? parseUtcDate(selectedPp.startDate).getMonth() : -1;

  function handleMonthSelect(monthIdx: number) {
    const monthStart = new Date(pickerYear, monthIdx, 1);
    const monthEnd   = new Date(pickerYear, monthIdx + 1, 0);
    const match =
      sortedPeriods.find((pp) => {
        const s = parseUtcDate(pp.startDate);
        return s.getFullYear() === pickerYear && s.getMonth() === monthIdx;
      }) ??
      sortedPeriods.find((pp) => {
        const s = parseUtcDate(pp.startDate);
        const e = parseUtcDate(pp.endDate);
        return s <= monthEnd && e >= monthStart;
      });
    if (match) navigate(match.id);
    setShowCalendar(false);
  }

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

  // New entry row (always-visible blank row at table bottom)
  const [newEntryDate, setNewEntryDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [newEntryMode, setNewEntryMode] = useState<"time" | "hours">("time");
  const [newInTimeStr, setNewInTimeStr] = useState("");
  const [newInAmPm, setNewInAmPm] = useState<"AM" | "PM">("AM");
  const [newOutTimeStr, setNewOutTimeStr] = useState("");
  const [newOutAmPm, setNewOutAmPm] = useState<"AM" | "PM">("PM");
  const [newEntryHours, setNewEntryHours] = useState("");
  const [newEntryPayCodeId, setNewEntryPayCodeId] = useState("");
  const [newEntryReasonCodeId, setNewEntryReasonCodeId] = useState("");
  const [newEntryNote, setNewEntryNote] = useState("");
  const [newEntryError, setNewEntryError] = useState<string | null>(null);

  // Punch editing / adding
  const [addingPunch, setAddingPunch] = useState<{ dayKey: string; pairIndex: number; punchType: "CLOCK_IN" | "CLOCK_OUT"; pairedTime: Date | null } | null>(null);
  const [editingPunchId, setEditingPunchId] = useState<string | null>(null);
  const [editTimeStr, setEditTimeStr] = useState("");
  const [editAmPm, setEditAmPm] = useState<"AM" | "PM">("AM");
  const [editOriginalDate, setEditOriginalDate] = useState<Date | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Rejection form
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  function handleQuickApprove(emp: EmployeeListItem & { timesheetId: string; status: string }) {
    setApprovingId(emp.timesheetId);
    const action = emp.status === "SUP_APPROVED" ? payrollApproveTimesheet : approveTimesheet;
    action({ timesheetId: emp.timesheetId }).then((result) => {
      setApprovingId(null);
      if (!result.success) setActionError((result as { success: false; error: string }).error);
      else router.refresh();
    });
  }

  // Meal waiver
  const [waiverError, setWaiverError] = useState<string | null>(null);

  // Add entry
  const [addEntryDay, setAddEntryDay] = useState<string | null>(null);
  const [showAddEntryModal, setShowAddEntryModal] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);

  // Notes modal
  const [noteDay, setNoteDay] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Manual hours inline editor
  const [editingHours, setEditingHours] = useState<{ dayKey: string; value: string } | null>(null);
  const [hoursError, setHoursError] = useState<string | null>(null);

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
    setWaiverError(null);
    setAddEntryDay(null);
    setShowAddEntryModal(false);
    setNoteDay(null);
    setNoteText("");
    setNoteSaving(false);
    setPendingPayCodes(new Map());
    setPendingReasonCodes(new Map());
    setPendingPunchEdits(new Map());
    setPendingNewPunches([]);
    setPendingWaiverToggles(new Set());
    setPendingDeletions([]);
    setEditingHours(null);
    setHoursError(null);
    setNewEntryMode("time");
    setNewEntryHours("");
  }, [timecard?.timesheetId]);

  const canEdit = !readOnly && (timecard
    ? (timecard.status !== "LOCKED" && timecard.status !== "PAYROLL_APPROVED")
    : (!!selectedEmployeeId && !!selectedPeriodId));

  const canDeleteManual =
    !!canEdit &&
    ["HR_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"].includes(userRole);

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

    // Pay type filter
    if (payTypeFilter === "HOURLY" && emp.payType !== "HOURLY") return false;
    if (payTypeFilter === "SALARY" && emp.payType !== "SALARY") return false;

    // Status filter (only applies when period-dependent data is present)
    const empStatus = emp.status ?? "OPEN";
    if (statusFilter === "ALL_EXCLUDING_OPEN" && empStatus === "OPEN") return false;
    if (statusFilter !== "ALL" && statusFilter !== "ALL_EXCLUDING_OPEN" && empStatus !== statusFilter) return false;

    // Exception filter (only applies when period-dependent data is present)
    const empExceptions = emp.exceptionTypes ?? [];
    if (exceptionFilter === "ALL_EXCEPTIONS" && empExceptions.length === 0) return false;
    if (exceptionFilter !== "ALL" && exceptionFilter !== "ALL_EXCEPTIONS" && !empExceptions.includes(exceptionFilter)) return false;

    return true;
  });

  function navigate(
    employeeId?: string | null,
    periodId?: string | null,
    sid: string | null = selectedSiteId,
    did: string | null = selectedDepartmentId,
  ) {
    const params = new URLSearchParams();
    const eid = employeeId ?? selectedEmployeeId;
    if (eid) params.set("employeeId", eid);
    if (periodId) params.set("periodId", periodId);
    if (sid) params.set("siteId", sid);
    if (did) params.set("departmentId", did);
    router.push(`/payroll/timecards?${params.toString()}`);
  }

  function navigateCustomRange(start: Date, end: Date) {
    const params = new URLSearchParams();
    params.set("customStart", format(start, "yyyy-MM-dd"));
    params.set("customEnd", format(end, "yyyy-MM-dd"));
    if (selectedEmployeeId) params.set("employeeId", selectedEmployeeId);
    if (selectedPeriodId) params.set("periodId", selectedPeriodId);
    if (selectedSiteId) params.set("siteId", selectedSiteId);
    if (selectedDepartmentId) params.set("departmentId", selectedDepartmentId);
    router.push(`/payroll/timecards?${params.toString()}`);
    setShowCalendar(false);
  }

  // Build daily data from timecard — use custom range if provided, else full pay period.
  // For the active pay period (today falls within it), only generate rows up to today
  // so future days don't appear until they arrive — except future dates that already
  // have segments (e.g. approved leave) which are pulled forward and shown immediately.
  const customStartDate = customStart ? new Date(customStart + "T12:00:00") : null;
  const customEndDate = customEnd ? new Date(customEnd + "T12:00:00") : null;
  const days = (() => {
    let periodStart: Date;
    let periodEnd: Date;

    if (timecard) {
      periodStart = customStartDate ?? parseUtcDate(timecard.payPeriod.startDate);
      periodEnd = customEndDate ?? parseUtcDate(timecard.payPeriod.endDate);
    } else if (selectedPeriodId && selectedEmployeeId) {
      // No timesheet yet — still build the day grid so absent days render
      const period = sortedPeriods.find((p) => p.id === selectedPeriodId);
      if (!period) return null;
      periodStart = parseUtcDate(period.startDate);
      periodEnd = parseUtcDate(period.endDate);
    } else {
      return null;
    }

    // Cap the end at today when today falls inside this pay period (and no custom range is set)
    const todayMidnight = new Date(today);
    const effectiveEnd =
      !customStartDate && !customEndDate && todayMidnight >= periodStart && todayMidnight < periodEnd
        ? todayMidnight
        : periodEnd;
    // Guard: if period hasn't started yet, nothing to show
    if (effectiveEnd < periodStart) return [];
    const baseDays = eachDayOfInterval({ start: periodStart, end: effectiveEnd });
    // Append any future dates (beyond effectiveEnd, within the period) that already have segments
    if (timecard && effectiveEnd < periodEnd) {
      const baseDayStrs = new Set(baseDays.map((d) => format(d, "yyyy-MM-dd")));
      const futureDayStrs = new Set(
        timecard.segments
          .map((s) => format(parseUtcDate(s.segmentDate), "yyyy-MM-dd"))
          .filter((ds) => !baseDayStrs.has(ds) && ds > format(effectiveEnd, "yyyy-MM-dd") && ds <= format(periodEnd, "yyyy-MM-dd"))
      );
      const futureDays = Array.from(futureDayStrs)
        .sort()
        .map((ds) => parseISO(ds));
      return [...baseDays, ...futureDays];
    }
    return baseDays;
  })();

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

  function startEditing(punch: TimecardPunch) {
    if (!canEdit) return;
    const d = pendingPunchEdits.get(punch.id) ?? parseISO(punch.roundedTime);
    const h24 = d.getHours();
    const minutes = d.getMinutes();
    const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    setEditingPunchId(punch.id);
    setAddingPunch(null);
    setEditTimeStr(`${h12}:${String(minutes).padStart(2, "0")}`);
    setEditAmPm(ampm);
    setEditOriginalDate(d);
    setEditError(null);
  }

  function cancelEditing() {
    setEditingPunchId(null);
    setAddingPunch(null);
    setEditError(null);
  }

  function handleCorrectPunchBlur() {
    if (!editingPunchId || !editOriginalDate) return;
    const parsed = parseTimeInput(editTimeStr);
    if (!parsed) { cancelEditing(); return; }
    let { hours, minutes } = parsed;
    if (editAmPm === "PM" && hours !== 12) hours += 12;
    if (editAmPm === "AM" && hours === 12) hours = 0;
    if (hours === editOriginalDate.getHours() && minutes === editOriginalDate.getMinutes()) {
      cancelEditing();
      return;
    }
    const newDate = new Date(editOriginalDate);
    newDate.setHours(hours, minutes, 0, 0);
    const punchId = editingPunchId;
    setPendingPunchEdits((prev) => { const n = new Map(prev); n.set(punchId, newDate); return n; });
    setEditingPunchId(null);
    setEditError(null);
  }

  function handleAddPunchBlur() {
    if (!addingPunch || !editOriginalDate || !timecard) return;
    if (!editTimeStr.trim()) { cancelEditing(); return; }
    const parsed = parseTimeInput(editTimeStr);
    if (!parsed) { cancelEditing(); return; }
    let { hours, minutes } = parsed;
    if (editAmPm === "PM" && hours !== 12) hours += 12;
    if (editAmPm === "AM" && hours === 12) hours = 0;
    const punchDate = new Date(editOriginalDate);
    punchDate.setHours(hours, minutes, 0, 0);
    const snap = addingPunch;

    // Validate against the existing paired punch captured at the time the edit was opened
    if (snap.pairedTime) {
      if (snap.punchType === "CLOCK_IN" && punchDate >= snap.pairedTime) {
        setEditError(`In time must be before out time (${format(snap.pairedTime, "h:mm a")})`);
        return;
      }
      if (snap.punchType === "CLOCK_OUT" && punchDate <= snap.pairedTime) {
        setEditError(`Out time must be after in time (${format(snap.pairedTime, "h:mm a")})`);
        return;
      }
    }

    setPendingNewPunches((prev) => [...prev, { dayKey: snap.dayKey, pairIndex: snap.pairIndex, punchType: snap.punchType, punchDate }]);
    setAddingPunch(null);
    setEditError(null);
  }

  function deletePunchDirect(punchId: string) {
    startTransition(async () => {
      const result = await deletePunch({ punchId, reason: "Removed by payroll" });
      if (!result.success) { setEditError(result.error); return; }
      setEditingPunchId(null);
      router.refresh();
    });
  }

  function queueDeleteManualPair(punchIds: string[], dayKey: string, inTime: string | null, outTime: string | null) {
    if (!canDeleteManual) return;
    setPendingDeletions((prev) => {
      const key = punchIds.join(",");
      const exists = prev.some((d) => d.punchIds.join(",") === key);
      if (exists) return prev.filter((d) => d.punchIds.join(",") !== key);
      return [...prev, { punchIds, dayKey, inTime, outTime }];
    });
  }

  function startAddingPunch(dayKey: string, pairIndex: number, punchType: "CLOCK_IN" | "CLOCK_OUT", day: Date, pairedTime: Date | null = null) {
    if (!canEdit) return;
    setAddingPunch({ dayKey, pairIndex, punchType, pairedTime });
    setEditingPunchId(null);
    setEditTimeStr("");
    setEditAmPm(punchType === "CLOCK_IN" ? "AM" : "PM");
    setEditOriginalDate(day);
    setEditError(null);
  }

  function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!timecard && (!selectedEmployeeId || !selectedPeriodId)) return;
    setNewEntryError(null);

    const inParsed = parseTimeInput(newInTimeStr);
    const outParsed = parseTimeInput(newOutTimeStr);
    if (!inParsed) { setNewEntryError("Invalid in time — enter something like 8:30 or 830"); return; }
    if (!outParsed) { setNewEntryError("Invalid out time — enter something like 5:00 or 1700"); return; }

    let inH = inParsed.hours;
    let outH = outParsed.hours;
    if (newInAmPm === "PM" && inH !== 12) inH += 12;
    if (newInAmPm === "AM" && inH === 12) inH = 0;
    if (newOutAmPm === "PM" && outH !== 12) outH += 12;
    if (newOutAmPm === "AM" && outH === 12) outH = 0;

    const inDate = new Date(
      `${newEntryDate}T${String(inH).padStart(2, "0")}:${String(inParsed.minutes).padStart(2, "0")}:00`
    );
    const outDate = new Date(
      `${newEntryDate}T${String(outH).padStart(2, "0")}:${String(outParsed.minutes).padStart(2, "0")}:00`
    );

    if (outDate <= inDate) {
      setNewEntryError("Out time must be after in time");
      return;
    }

    // Client-side overlap check against existing punch pairs for this date
    if (timecard) {
      const dayPunches = timecard.punches
        .filter((p) => format(parseISO(p.roundedTime), "yyyy-MM-dd") === newEntryDate)
        .sort((a, b) => parseISO(a.roundedTime).getTime() - parseISO(b.roundedTime).getTime());
      for (let i = 0; i < dayPunches.length; i++) {
        if (dayPunches[i].punchType !== "CLOCK_IN") continue;
        const nextOut = dayPunches.slice(i + 1).find((p) => p.punchType === "CLOCK_OUT");
        if (!nextOut) continue;
        const existIn = parseISO(dayPunches[i].roundedTime).getTime();
        const existOut = parseISO(nextOut.roundedTime).getTime();
        if (inDate.getTime() < existOut && outDate.getTime() > existIn) {
          const s = format(parseISO(dayPunches[i].roundedTime), "h:mm a");
          const en = format(parseISO(nextOut.roundedTime), "h:mm a");
          setNewEntryError(`Overlaps with existing entry ${s} – ${en}`);
          return;
        }
      }
    }

    startTransition(async () => {
      let timesheetId: string = timecard?.timesheetId ?? "";
      if (!timesheetId) {
        const ensureResult = await ensureTimesheet({ employeeId: selectedEmployeeId!, periodId: selectedPeriodId! });
        if (!ensureResult.success) {
          setNewEntryError("Failed to create timesheet");
          return;
        }
        timesheetId = ensureResult.data.timesheetId;
      }
      const result = await addManualPunchPair({
        timesheetId,
        date: newEntryDate,
        inTime: inDate.toISOString(),
        outTime: outDate.toISOString(),
        reason: "Manual entry",
        payCodeId: newEntryPayCodeId || undefined,
      });
      if (!result.success) {
        setNewEntryError(result.error ?? "Failed to add entry");
        return;
      }
      if (newEntryReasonCodeId) {
        await setDayReasonCode({
          timesheetId,
          segmentDate: newEntryDate,
          reasonCodeId: newEntryReasonCodeId,
        });
      }
      const inFormatted = format(inDate, "h:mm a");
      const outFormatted = format(outDate, "h:mm a");
      const entryLines: string[] = [`  In/Out: ${inFormatted} – ${outFormatted}`];
      if (newEntryPayCodeId) {
        const codeLabel = payCodes.find((c) => c.id === newEntryPayCodeId)?.label;
        if (codeLabel) entryLines.push(`  Pay code: ${codeLabel}`);
      }
      if (newEntryReasonCodeId) {
        const reasonLabel = reasonCodes.find((r) => r.id === newEntryReasonCodeId)?.label;
        if (reasonLabel) entryLines.push(`  Reason code: ${reasonLabel}`);
      }
      if (newEntryNote.trim()) entryLines.push(`  Note: ${newEntryNote.trim()}`);
      const noteResult = await saveTimesheetNote({
        timesheetId,
        noteDate: newEntryDate,
        note: `Entry added\n${entryLines.join("\n")}`,
      });
      if (!noteResult.success) {
        console.error("saveTimesheetNote failed:", noteResult.error);
        setNewEntryError(`Entry added but note failed to save: ${noteResult.error}`);
        router.refresh();
        return;
      }
      setNewInTimeStr("");
      setNewOutTimeStr("");
      setNewEntryPayCodeId("");
      setNewEntryReasonCodeId("");
      setNewEntryNote("");
      setNewEntryError(null);
      setShowAddEntryModal(false);
      router.refresh();
    });
  }

  function handleAddHoursEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!timecard && (!selectedEmployeeId || !selectedPeriodId)) return;
    setNewEntryError(null);
    const hours = parseFloat(newEntryHours);
    if (isNaN(hours) || hours < 0.25 || hours > 24) {
      setNewEntryError("Enter hours between 0.25 and 24");
      return;
    }
    startTransition(async () => {
      let timesheetId: string = timecard?.timesheetId ?? "";
      if (!timesheetId) {
        const ensureResult = await ensureTimesheet({ employeeId: selectedEmployeeId!, periodId: selectedPeriodId! });
        if (!ensureResult.success) { setNewEntryError("Failed to create timesheet"); return; }
        timesheetId = ensureResult.data.timesheetId;
      }
      const result = await addManualHoursEntry({
        timesheetId,
        date: newEntryDate,
        hours,
        payCodeId: newEntryPayCodeId || undefined,
        note: newEntryNote.trim() || undefined,
      });
      if (!result.success) { setNewEntryError(result.error ?? "Failed to add entry"); return; }
      if (newEntryReasonCodeId) {
        await setDayReasonCode({ timesheetId, segmentDate: newEntryDate, reasonCodeId: newEntryReasonCodeId });
      }
      if (newEntryNote.trim()) {
        await saveTimesheetNote({ timesheetId, noteDate: newEntryDate, note: `Manual hours entry: ${hours}h\n  Note: ${newEntryNote.trim()}` });
      }
      setNewEntryHours("");
      setNewEntryPayCodeId("");
      setNewEntryReasonCodeId("");
      setNewEntryNote("");
      setNewEntryError(null);
      setShowAddEntryModal(false);
      router.refresh();
    });
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

  function handleDeletePunch(punchId: string) {
    if (!window.confirm("Remove this punch? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deletePunch({ punchId, reason: "Removed by payroll" });
      if (!result.success) {
        setEditError(result.error);
        return;
      }
      setEditingPunchId(null);
      router.refresh();
    });
  }

  function handleAuthorizeOt() {
    if (!timecard) return;
    setActionError(null);
    startTransition(async () => {
      const result = await authorizeTimecardOt({ timesheetId: timecard.timesheetId });
      if (!result.success) setActionError(result.error);
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

  function handleToggleWaiver(segmentDate: string) {
    setWaiverError(null);
    setPendingWaiverToggles((prev) => {
      const n = new Set(prev);
      if (n.has(segmentDate)) n.delete(segmentDate); else n.add(segmentDate);
      return n;
    });
  }

  function handleTogglePremiumWaiver(segmentStart: string, segmentDate: string) {
    setPendingPremiumWaiverToggles((prev) => {
      const n = new Map(prev);
      if (n.has(segmentStart)) n.delete(segmentStart); else n.set(segmentStart, segmentDate);
      return n;
    });
  }

  function handlePayCodeChange(segmentId: string, payCodeId: string, dayKey?: string) {
    setPendingPayCodes((prev) => {
      const n = new Map(prev);
      n.set(segmentId, payCodeId);
      // Cascade to all other WORK segments on the same day so every pair gets the code
      if (dayKey) {
        timecard?.segments
          .filter((s) => format(parseUtcDate(s.segmentDate), "yyyy-MM-dd") === dayKey && s.segmentType === "WORK" && s.id !== segmentId)
          .forEach((s) => n.set(s.id, payCodeId));
      }
      return n;
    });
  }

  function handleAbsentDayPayCodeChange(_timesheetId: string | null, segmentDate: string, payCodeId: string) {
    setPendingPayCodes((prev) => { const n = new Map(prev); n.set(`absent:${segmentDate}`, payCodeId); return n; });
  }

  function handlePayBucketChange(segmentId: string, payBucket: string) {
    startTransition(async () => {
      await setSegmentPayBucket({ segmentId, payBucket });
      router.refresh();
    });
  }

  function handleDayReasonCodeChange(_timesheetId: string | null, segmentDate: string, reasonCodeId: string) {
    setPendingReasonCodes((prev) => { const n = new Map(prev); n.set(segmentDate, reasonCodeId); return n; });
  }

  function handleAbsentPayBucketChange(timesheetId: string, segmentDate: string, payBucket: string) {
    startTransition(async () => {
      await setAbsentDayPayBucket({ timesheetId, segmentDate, payBucket: payBucket || null });
      router.refresh();
    });
  }

  const hasPendingChanges = pendingPayCodes.size > 0 || pendingReasonCodes.size > 0 || pendingPunchEdits.size > 0 || pendingNewPunches.length > 0 || pendingWaiverToggles.size > 0 || pendingPremiumWaiverToggles.size > 0 || pendingDeletions.length > 0 || pendingHoursEntries.length > 0;

  function handleDiscardChanges() {
    setPendingPayCodes(new Map());
    setPendingReasonCodes(new Map());
    setPendingPunchEdits(new Map());
    setPendingNewPunches([]);
    setPendingWaiverToggles(new Set());
    setPendingPremiumWaiverToggles(new Map());
    setPendingDeletions([]);
    setPendingHoursEntries([]);
  }

  function handleSaveChanges() {
    setActionError(null);
    startTransition(async () => {
      try {
        // Resolve timesheetId — create a timesheet on demand if the employee has none yet
        let timesheetId = timecard?.timesheetId ?? null;
        if (!timesheetId && selectedEmployeeId && selectedPeriodId) {
          const ts = await ensureTimesheet({ employeeId: selectedEmployeeId, periodId: selectedPeriodId });
          if (!ts.success) { setActionError(ts.error ?? "Failed to create timesheet"); return; }
          timesheetId = ts.data.timesheetId;
        }
        if (!timesheetId) return;

        // ── Collect per-day change descriptions before saving ────────
        const dayChanges = new Map<string, string[]>();
        function addChange(dayKey: string, desc: string) {
          const list = dayChanges.get(dayKey) ?? [];
          list.push(desc);
          dayChanges.set(dayKey, list);
        }

        for (const [key, payCodeId] of pendingPayCodes.entries()) {
          if (key.startsWith("absent:")) {
            const segmentDate = key.slice(7);
            const oldSeg = timecard?.segments.find(
              (s) =>
                format(parseUtcDate(s.segmentDate), "yyyy-MM-dd") === segmentDate &&
                s.segmentType === "LEAVE" &&
                s.durationMinutes === 0
            );
            const oldLabel = oldSeg?.payCode?.label ?? "None";
            const newLabel = payCodes.find((c) => c.id === payCodeId)?.label ?? (payCodeId ? "Unknown" : "Cleared");
            addChange(segmentDate, `Pay code: ${oldLabel} → ${newLabel}`);
          } else {
            const seg = timecard?.segments.find((s) => s.id === key);
            if (seg) {
              const segDate = format(parseUtcDate(seg.segmentDate), "yyyy-MM-dd");
              const oldLabel = seg.payCode?.label ?? "None";
              const newLabel = payCodes.find((c) => c.id === payCodeId)?.label ?? (payCodeId ? "Unknown" : "Cleared");
              addChange(segDate, `Pay code: ${oldLabel} → ${newLabel}`);
            }
          }
        }

        for (const [segmentDate, reasonCodeId] of pendingReasonCodes.entries()) {
          const oldReason = timecard?.dayReasons.find((dr) => dr.segmentDate === segmentDate);
          const oldLabel = oldReason?.reasonCode.label ?? "None";
          const newLabel = reasonCodes.find((r) => r.id === reasonCodeId)?.label ?? (reasonCodeId ? "Unknown" : "Cleared");
          addChange(segmentDate, `Reason code: ${oldLabel} → ${newLabel}`);
        }

        for (const [punchId, newDate] of pendingPunchEdits.entries()) {
          const punch = timecard?.punches.find((p) => p.id === punchId);
          if (punch) {
            const dayKey = format(parseISO(punch.roundedTime), "yyyy-MM-dd");
            const typeLabel = PUNCH_TYPE_LABEL[punch.punchType as PunchTypeValue] ?? punch.punchType;
            const oldTime = format(parseISO(punch.roundedTime), "h:mm a");
            const newTime = format(newDate, "h:mm a");
            addChange(dayKey, `${typeLabel} corrected: ${oldTime} → ${newTime}`);
          }
        }

        for (const { dayKey, punchType, punchDate } of pendingNewPunches) {
          const typeLabel = punchType === "CLOCK_IN" ? "Clock In" : "Clock Out";
          addChange(dayKey, `${typeLabel} added: ${format(punchDate, "h:mm a")}`);
        }

        for (const segmentDate of pendingWaiverToggles) {
          const hasWaiver = timecard?.mealWaivers.some((w) => w.segmentDate === segmentDate);
          addChange(segmentDate, hasWaiver ? "Meal waiver removed" : "Meal waiver added");
        }

        for (const { dayKey, inTime, outTime } of pendingDeletions) {
          const timeRange = [inTime, outTime].filter(Boolean).join(" – ");
          addChange(dayKey, `Entry deleted${timeRange ? `: ${timeRange}` : ""}`);
        }
        for (const { dayKey, hours } of pendingHoursEntries) {
          addChange(dayKey, `Manual hours added: ${hours}h`);
        }
        // ─────────────────────────────────────────────────────────────

        const ops: Promise<unknown>[] = [];
        for (const [key, payCodeId] of pendingPayCodes.entries()) {
          if (key.startsWith("absent:")) {
            const segDate = key.slice(7);
            // Skip: addManualHoursEntry will handle the pay code for this day
            if (pendingHoursEntries.some((e) => e.dayKey === segDate)) continue;
            ops.push(setAbsentDayPayCode({ timesheetId, segmentDate: segDate, payCodeId: payCodeId || null }));
          } else {
            ops.push(setSegmentPayCode({ segmentId: key, payCodeId: payCodeId || null }));
          }
        }
        for (const [segmentDate, reasonCodeId] of pendingReasonCodes.entries()) {
          ops.push(setDayReasonCode({ timesheetId, segmentDate, reasonCodeId: reasonCodeId || null }));
        }
        for (const [punchId, newDate] of pendingPunchEdits.entries()) {
          ops.push(correctPunch({ originalPunchId: punchId, newPunchTime: newDate.toISOString() }));
        }
        for (const { punchType, punchDate } of pendingNewPunches) {
          ops.push(addSingleManualPunch({ timesheetId, punchType, punchTime: punchDate.toISOString() }));
        }
        for (const segmentDate of pendingWaiverToggles) {
          ops.push(toggleMealWaiver({ timesheetId, segmentDate }));
        }
        for (const [segmentStart, segmentDate] of pendingPremiumWaiverToggles) {
          ops.push(toggleMealPremiumWaiver({ timesheetId, segmentDate, segmentStart }));
        }
        for (const { punchIds } of pendingDeletions) {
          ops.push(deleteManualPunchPair({ punchIds }));
        }
        for (const { dayKey, hours, payCodeId } of pendingHoursEntries) {
          ops.push(addManualHoursEntry({ timesheetId, date: dayKey, hours, ...(payCodeId ? { payCodeId } : {}) }));
        }
        await Promise.all(ops);

        // Save one audit note per affected day
        const noteOps: Promise<unknown>[] = [];
        for (const [dayKey, changes] of dayChanges.entries()) {
          noteOps.push(
            saveTimesheetNote({
              timesheetId,
              noteDate: dayKey,
              note: `Changes saved\n${changes.map((c) => `  ${c}`).join("\n")}`,
            })
          );
        }
        await Promise.all(noteOps);

        setPendingPayCodes(new Map());
        setPendingReasonCodes(new Map());
        setPendingPunchEdits(new Map());
        setPendingNewPunches([]);
        setPendingWaiverToggles(new Set());
        setPendingPremiumWaiverToggles(new Map());
        setPendingDeletions([]);
        setPendingHoursEntries([]);
        router.refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to save changes");
      }
    });
  }

  function handleOpenNote(dayStr: string) {
    setNoteDay(dayStr);
    setNoteText("");
  }

  function handleHoursBlur() {
    if (!editingHours) return;
    const raw = editingHours.value.trim();
    if (!raw) { setEditingHours(null); return; }
    const hours = parseFloat(raw);
    if (isNaN(hours) || hours < 0.25 || hours > 24) {
      setHoursError("Enter hours between 0.25 and 24");
      return;
    }
    const dayKey = editingHours.dayKey;
    setEditingHours(null);
    setHoursError(null);
    // Capture the pay code for this day: prefer a pending change, fall back to existing segment
    const payCodeId =
      pendingPayCodes.get("absent:" + dayKey) ??
      timecard?.segments.find((s) => {
        try { return format(parseUtcDate(s.segmentDate), "yyyy-MM-dd") === dayKey && !!s.payCode?.id; } catch { return false; }
      })?.payCode?.id ??
      undefined;
    setPendingHoursEntries((prev) => {
      const filtered = prev.filter((e) => e.dayKey !== dayKey);
      return [...filtered, { dayKey, hours, payCodeId }];
    });
  }

  function handleSaveNote() {
    if (!timecard || !noteDay || !noteText.trim()) return;
    setNoteSaving(true);
    startTransition(async () => {
      await saveTimesheetNote({
        timesheetId: timecard.timesheetId,
        noteDate: noteDay,
        note: noteText,
      });
      setNoteText("");
      setNoteSaving(false);
      router.refresh();
    });
  }

  // Effective meal deduction settings: shift overrides ruleset, matching segment-builder logic.
  const shiftMeal = timecard?.employee.shift?.mealConfig;
  const shiftFirstMeal = shiftMeal?.meals?.[0];
  const effectiveAutoDeductMeal = timecard
    ? (timecard.employee.shift ? (shiftMeal?.autoDeduct ?? false) : timecard.employee.ruleSet.autoDeductMeal)
    : false;
  const effectiveMealBreakAfterMinutes = shiftMeal?.autoDeduct && shiftFirstMeal
    ? Math.round(shiftFirstMeal.workAtLeastHours * 60)
    : (timecard?.employee.ruleSet.mealBreakAfterMinutes ?? 0);
  const hasMealPremiums = timecard?.segments.some(s => s.segmentType === "MEAL_PREMIUM") ?? false;
  const showMealColumn = effectiveAutoDeductMeal || hasMealPremiums;

  // Column count for colSpan on expanded rows
  // Base: chevron + date + notes-icon + in + out + reg + ot + dt + total = 9
  // +1 if pay codes column exists, +1 if reason codes column exists, +1 if delete column shown
  const colCount = 9 + (payCodes.length > 0 ? 1 : 0) + (reasonCodes.length > 0 ? 1 : 0) + (showMealColumn ? 1 : 0) + (canDeleteManual ? 1 : 0);

  const canApprove =
    timecard &&
    (timecard.status === "SUBMITTED" || timecard.status === "SUP_APPROVED");
  const canReject =
    timecard &&
    (timecard.status === "SUBMITTED" || timecard.status === "SUP_APPROVED");

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 h-[calc(100vh-7.25rem)]">
      {/* ── Top bar: pay period filter bar ─────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Pay frequency indicator */}
        <span className="inline-flex items-center rounded-md bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          {PAY_FREQUENCY_LABEL[payFrequency as PayFrequencyValue] ??
            payFrequency}
        </span>

        {/* Jump to current pay period */}
        <button
          type="button"
          onClick={() => currentPeriod && navigate(selectedEmployeeId, currentPeriod.id)}
          disabled={!currentPeriod || selectedPeriodId === currentPeriod.id}
          title="Jump to current pay period"
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:cursor-default disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          <CalendarCheck className="h-4 w-4" />
        </button>

        {/* Previous / Next arrows with date display */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() =>
              hasPrev && navigate(selectedEmployeeId, sortedPeriods[currentIndex - 1].id)
            }
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Previous pay period"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[220px] text-center text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
            {(() => {
              const sel = sortedPeriods[currentIndex];
              if (!sel) return "—";
              const s = parseUtcDate(sel.startDate);
              const e = addDays(parseUtcDate(sel.endDate), -1);
              return `${format(s, "MM/dd/yyyy")} (${format(s, "EEE")}) – ${format(e, "MM/dd/yyyy")} (${format(e, "EEE")})`;
            })()}
          </span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() =>
              hasNext && navigate(selectedEmployeeId, sortedPeriods[currentIndex + 1].id)
            }
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Next pay period"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Month/year jump picker */}
        <div className="relative" ref={calendarRef}>
          <button
            type="button"
            onClick={() => {
              if (!showCalendar && selectedPp) {
                setPickerYear(parseUtcDate(selectedPp.startDate).getFullYear());
              }
              setShowCalendar((v) => !v);
            }}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Jump to month"
          >
            <Calendar className="h-4 w-4" />
          </button>
          {showCalendar && (
            <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              {/* Year navigation */}
              <div className="mb-2.5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  {pickerYear}
                </span>
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y + 1)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {/* Month grid */}
              <div className="grid grid-cols-4 gap-1">
                {MONTHS.map((label, idx) => {
                  const hasPeriod = monthsWithPeriods.has(idx);
                  const isSelected = pickerYear === selectedMonthYear && idx === selectedMonthIdx;
                  const isCurrentMonth =
                    pickerYear === new Date().getFullYear() && idx === new Date().getMonth();
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={!hasPeriod}
                      onClick={() => handleMonthSelect(idx)}
                      className={`rounded py-1.5 text-xs font-medium transition-colors
                        ${isSelected
                          ? "bg-blue-600 text-white"
                          : isCurrentMonth && hasPeriod
                            ? "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-950/50"
                            : hasPeriod
                              ? "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                              : "cursor-default text-zinc-300 dark:text-zinc-600"
                        }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Site filter */}
        {sites.length > 0 && (
          <select
            value={selectedSiteId ?? ""}
            onChange={(e) => navigate(null, selectedPeriodId, e.target.value || null, null)}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="">All Sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}

        {/* Department filter */}
        <select
          value={selectedDepartmentId ?? ""}
          onChange={(e) => navigate(selectedEmployeeId, selectedPeriodId, selectedSiteId, e.target.value || null)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <span className="ml-auto text-xs text-zinc-400">
          {employees.length} employee{employees.length !== 1 && "s"}
        </span>
      </div>

      {/* ── Split pane ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-[260px_1fr] flex-1 min-h-0">
        {/* ── Left: employee list ─────────────────────────────────────── */}
        <div className="flex flex-col min-h-0 border-r border-zinc-200 dark:border-zinc-800">
          <div className="shrink-0 space-y-2 border-b border-zinc-200 p-2.5 dark:border-zinc-800">
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
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            >
              <option value="ALL">All Statuses</option>
              <option value="ALL_EXCLUDING_OPEN">Excluding Open</option>
              <option value="OPEN">Open</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="SUP_APPROVED">Supervisor Approved</option>
              <option value="PAYROLL_APPROVED">Payroll Approved</option>
              <option value="LOCKED">Locked</option>
            </select>
            {/* Pay type filter */}
            <select
              value={payTypeFilter}
              onChange={(e) => setPayTypeFilter(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            >
              <option value="ALL">All Pay Types</option>
              <option value="HOURLY">Hourly</option>
              <option value="SALARY">Salary</option>
            </select>
            {/* Exception filter */}
            <select
              value={exceptionFilter}
              onChange={(e) => setExceptionFilter(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            >
              <option value="ALL">All</option>
              <option value="ALL_EXCEPTIONS">All Exceptions</option>
              <option value="MISSING_PUNCH">Missing Punch</option>
              <option value="LONG_SHIFT">Long Shift</option>
              <option value="SHORT_BREAK">Short Break</option>
              <option value="MISSED_MEAL">Missed Meal</option>
              <option value="UNSCHEDULED_OT">Unscheduled OT</option>
              <option value="CONSECUTIVE_DAYS">Consecutive Days</option>
              <option value="ABSENT">Absent</option>
              <option value="LATE_IN">Late In</option>
              <option value="EARLY_OUT">Early Out</option>
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
            {(() => {
              // Group employees by site, preserving alphabetical order within each group
              const groupMap = new Map<string, { siteName: string; employees: EmployeeListItem[] }>();
              for (const emp of filteredEmployees) {
                const key = emp.siteId ?? "__none__";
                const label = emp.siteName ?? "No Site";
                if (!groupMap.has(key)) groupMap.set(key, { siteName: label, employees: [] });
                groupMap.get(key)!.employees.push(emp);
              }
              const groups = Array.from(groupMap.values()).sort((a, b) =>
                a.siteName.localeCompare(b.siteName)
              );
              const showHeaders = groups.length > 1 || (groups.length === 1 && groups[0].siteName !== "No Site");

              return groups.map((group) => (
                <React.Fragment key={group.siteName}>
                  {showHeaders && (
                    <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-100 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/80">
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        {group.siteName}
                      </span>
                    </div>
                  )}
                  {group.employees.map((emp) => {
                    const isSelected = emp.employeeId === selectedEmployeeId;
                    const empStatus = emp.status ?? "OPEN";
                    const empExceptions = emp.exceptionTypes ?? [];
                    const canQuickApprove = emp.timesheetId && (empStatus === "SUBMITTED" || empStatus === "SUP_APPROVED");
                    return (
                      <div
                        key={emp.employeeId}
                        onClick={() => navigate(emp.employeeId)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(emp.employeeId); }}
                        tabIndex={0}
                        role="button"
                        className={`flex w-full cursor-pointer flex-col border-b border-zinc-100 px-3 py-2.5 text-left transition-colors dark:border-zinc-800/60 ${
                          isSelected
                            ? "bg-blue-50 dark:bg-blue-950/30"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <p
                            className={`flex min-w-0 items-center gap-1.5 truncate text-sm font-medium ${
                              isSelected
                                ? "text-zinc-900 dark:text-white"
                                : "text-zinc-700 dark:text-zinc-300"
                            }`}
                          >
                            {empExceptions.length > 0 && (
                              <span
                                title={`${empExceptions.length} exception${empExceptions.length !== 1 ? "s" : ""}`}
                                className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400 dark:bg-amber-500"
                              />
                            )}
                            {emp.name}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {emp.totalMinutes !== undefined && (
                              <span className="text-xs tabular-nums text-zinc-400">
                                {minutesToHoursDecimal(emp.totalMinutes)}h
                              </span>
                            )}
                            {canQuickApprove && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleQuickApprove(emp as EmployeeListItem & { timesheetId: string; status: string }); }}
                                disabled={approvingId === emp.timesheetId}
                                title={empStatus === "SUP_APPROVED" ? "Payroll Approve" : "Approve"}
                                className="rounded bg-green-600 p-0.5 text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                {approvingId === emp.timesheetId
                                  ? <span className="block w-3 text-center text-xs leading-none">…</span>
                                  : <Check className="h-3 w-3" />}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="truncate text-xs text-zinc-400">
                            {emp.employeeCode} · {emp.department}
                          </p>
                          {emp.status && (
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[empStatus] ?? STATUS_BADGE.OPEN}`}>
                              {TIMESHEET_STATUS_LABEL[empStatus as TimesheetStatusValue] ?? empStatus}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ));
            })()}
          </div>
        </div>

        {/* ── Right: timecard detail ──────────────────────────────────── */}
        <div className="flex flex-col min-h-0 bg-white dark:bg-zinc-950">
          {!selectedEmployeeId || !days ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-zinc-400">
                Select an employee to view their timecard.
              </p>
            </div>
          ) : (
            <>
              {/* ── Employee header with status + actions ─────────────── */}
              {(() => {
                const listEmp = employees.find((e) => e.employeeId === selectedEmployeeId);
                const displayName = timecard?.employee.user?.name ?? listEmp?.name ?? selectedEmployeeId;
                const displayCode = timecard?.employee.employeeCode ?? listEmp?.employeeCode ?? "";
                const displayDept = timecard?.employee.department.name ?? listEmp?.department ?? "";
                const displayPayType = timecard?.employee.payType ?? null;
                return (
              <div className="shrink-0 flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-base font-bold text-zinc-900 dark:text-white">
                        {displayName}
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
                    <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                      {displayCode} · {displayDept}
                      {displayPayType && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          displayPayType === "SALARY"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        }`}>
                          {displayPayType === "SALARY" ? "Salary" : "Hourly"}
                        </span>
                      )}
                    </p>
                  </div>
                  {timecard ? (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_BADGE[timecard.status] ?? STATUS_BADGE.OPEN
                      }`}
                    >
                      {TIMESHEET_STATUS_LABEL[
                        timecard.status as TimesheetStatusValue
                      ] ?? timecard.status}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      No Punches
                    </span>
                  )}
                  {timecard && timecard.exceptionCount > 0 && (
                    <span className="text-xs text-amber-500">
                      {timecard.exceptionCount} exception
                      {timecard.exceptionCount !== 1 && "s"}
                    </span>
                  )}
                  {timecard &&
                    timecard.employee.ruleSet.overtimeRequiresAuth &&
                    !timecard.otAuthorized &&
                    (timecard.overtimeBuckets.some((b) => b.bucket === "OT" && b.totalMinutes > 0) ||
                      timecard.overtimeBuckets.some((b) => b.bucket === "DT" && b.totalMinutes > 0)) && (
                    <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      OT Unauthorized
                    </span>
                  )}
                </div>

                {/* Approval / Reject */}
                <div className="flex items-center gap-2">
                  {canEdit && (
                    <>
                      {timecard && <RecalculateButton timesheetId={timecard.timesheetId} />}
                      <button
                        type="button"
                        onClick={() => {
                          setNewEntryDate(format(new Date(), "yyyy-MM-dd"));
                          setNewInTimeStr("");
                          setNewOutTimeStr("");
                          setNewInAmPm("AM");
                          setNewOutAmPm("PM");
                          setNewEntryHours("");
                          setNewEntryPayCodeId("");
                          setNewEntryReasonCodeId("");
                          setNewEntryNote("");
                          setNewEntryError(null);
                          setNewEntryMode("time");
                          setShowAddEntryModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Entry
                      </button>
                    </>
                  )}
                  {canEdit && hasPendingChanges && (
                    <>
                      <button
                        type="button"
                        onClick={handleDiscardChanges}
                        disabled={isPending}
                        className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveChanges}
                        disabled={isPending}
                        className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isPending ? "Saving…" : "Save Changes"}
                      </button>
                    </>
                  )}
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
                      {timecard &&
                        timecard.employee.ruleSet.overtimeRequiresAuth &&
                        timecard.employee.ruleSet.allowTimesheetOtAuth &&
                        !timecard.otAuthorized &&
                        (timecard.overtimeBuckets.some((b) => b.bucket === "OT" && b.totalMinutes > 0) ||
                          timecard.overtimeBuckets.some((b) => b.bucket === "DT" && b.totalMinutes > 0)) && (
                        <button
                          onClick={handleAuthorizeOt}
                          disabled={isPending}
                          className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50"
                        >
                          {isPending ? "Saving…" : "Authorize OT"}
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
                );
              })()}

              {/* ── Scrollable timecard table + summary ──────────────── */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b-2 border-zinc-400 bg-zinc-300 dark:border-zinc-500 dark:bg-zinc-700">
                    <tr>
                      <th className="w-7 pl-2 pr-0 py-1.5" />
                      <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">Date</th>
                      {payCodes.length > 0 && (
                        <th className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">Code</th>
                      )}
                      {reasonCodes.length > 0 && (
                        <th className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">Reason</th>
                      )}
                      <th className="w-7 px-1 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">Notes</th>
                      <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">In</th>
                      <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">Out</th>
                      <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">Reg</th>
                      <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">OT</th>
                      <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">DT</th>
                      <th className="pl-3 pr-8 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">Total</th>
                      {showMealColumn && (
                        <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-200">Meal</th>
                      )}
                      {canDeleteManual && <th className="w-8 px-1 py-1.5" />}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const listEmpForSalary = employees.find((e) => e.employeeId === selectedEmployeeId);
                      const isSalaryEmployee =
                        (timecard?.employee.payType ?? listEmpForSalary?.payType) === "SALARY";
                      const SALARY_VIRTUAL_MINS = 480;
                      return days.map((day) => {
                      const dayKey = format(day, "yyyy-MM-dd");
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
                        // REG/OT/DT overrides are display-only tags; use engine payBucket for column math
                        const eb = (seg.payBucketOverride && !["REG", "OT", "DT"].includes(seg.payBucketOverride))
                          ? seg.payBucketOverride
                          : seg.payBucket;
                        // Holiday, leave, and meal premiums all credit under the REG column
                        const displayBucket = (seg.segmentType === "HOLIDAY" || seg.segmentType === "LEAVE" || seg.segmentType === "MEAL_PREMIUM") ? "REG" : eb;
                        buckets[displayBucket] = (buckets[displayBucket] ?? 0) + seg.durationMinutes;
                      }

                      const reg = buckets["REG"] ?? 0;
                      const ot = buckets["OT"] ?? 0;
                      const dt = buckets["DT"] ?? 0;
                      const dailyTotal = daySegments
                        .filter((s) => s.isPaid)
                        .reduce((a, s) => a + s.durationMinutes, 0);

                      const pairs = buildPunchPairs(dayPunches);
                      const firstIn = pairs[0]?.inPunch ?? undefined;
                      const lastOut = pairs[0]?.outPunch ?? undefined;

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
                      const hasException = dayExceptions.length > 0;
                      const hasMissingPunch = dayExceptions.some(
                        (e) => e.exceptionType === "MISSING_PUNCH"
                      );
                      // Consider a day "absent" if it's a weekday, not today,
                      // past, has no punches and no leave segments.
                      // Salary employees get virtual 8h credit — never absent.
                      const isPast = day < today;
                      const isSalaryVirtualDay =
                        !timecard && isSalaryEmployee && !isWeekend && !isTodayRow && isPast;
                      const isAbsent =
                        !isWeekend &&
                        !isTodayRow &&
                        isPast &&
                        dayPunches.length === 0 &&
                        leaveSegments.length === 0 &&
                        daySegments.length === 0 &&
                        !isSalaryVirtualDay;

                      const mainPunchIds = [firstIn?.id, lastOut?.id].filter(Boolean) as string[];
                      const isMainRowPendingDelete = mainPunchIds.length > 0 && pendingDeletions.some(
                        (d) => d.punchIds.join(",") === mainPunchIds.join(",")
                      );

                      return (
                        <React.Fragment key={dayKey}>
                          {/* Week separator */}
                          {showWeekSeparator && (
                            <tr aria-hidden>
                              <td colSpan={colCount} className="h-0 border-t-2 border-zinc-300 dark:border-zinc-600 p-0" />
                            </tr>
                          )}

                          {/* Day summary row */}
                          <tr
                            className={`border-b border-zinc-200 dark:border-zinc-700 transition-colors ${
                              isMainRowPendingDelete
                                ? "opacity-40 line-through"
                                : isAbsent
                                  ? "bg-red-100 dark:bg-red-950/40"
                                  : hasException
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
                            <td className={`px-3 py-1.5 text-sm font-medium tabular-nums ${
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
                              </span>
                            </td>

                            {/* Pay code */}
                            {payCodes.length > 0 && (
                              <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                {(() => {
                                  const workSeg = daySegments.find(
                                    (s) => s.segmentType === "WORK" || s.segmentType === "LEAVE"
                                  );
                                  // 0-duration marker = absent day with a code override
                                  const isMarker = !!workSeg && workSeg.durationMinutes === 0;
                                  const dayStr = format(day, "yyyy-MM-dd");

                                  // Missed-punch day: past day with punches but no work segments and no marker.
                                  // Excludes today — an open clock-in (still working) is not a missed punch.
                                  const isMissedPunchDay = !isTodayRow && dayPunches.length > 0 && daySegments.filter(s => s.segmentType === "WORK").length === 0 && !isMarker;

                                  const absentDropdownClass = (pending: boolean) =>
                                    `w-24 rounded border px-1 py-0.5 text-xs focus:outline-none ${pending ? "border-amber-400 bg-amber-50/50 text-zinc-700 dark:border-amber-600 dark:bg-amber-950/10 dark:text-zinc-300" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`;

                                  if (isAbsent || isMarker || isMissedPunchDay || (isSalaryVirtualDay && daySegments.length === 0)) {
                                    if (canEdit) {
                                      const absentKey = `absent:${dayStr}`;
                                      const absentPending = pendingPayCodes.has(absentKey);
                                      // Pre-populate missed-punch days with the rule set's default pay code
                                      // so the dropdown doesn't show "Absent" before a recalculate creates the marker.
                                      const regularId = !isMarker && isMissedPunchDay
                                        ? (timecard?.employee.ruleSet?.defaultPayCodeId ?? payCodes.find((pc) => pc.code === 0)?.id ?? "")
                                        : "";
                                      const currentValue = absentPending
                                        ? (pendingPayCodes.get(absentKey) ?? "")
                                        : isMarker
                                          ? (workSeg.payCode?.id ?? "")
                                          : regularId;
                                      return (
                                        <select
                                          value={currentValue}
                                          onChange={(e) =>
                                            handleAbsentDayPayCodeChange(timecard?.timesheetId ?? null, dayStr, e.target.value)
                                          }
                                          className={absentDropdownClass(absentPending)}
                                        >
                                          <option value="">Absent</option>
                                          {payCodes.map((pc) => (
                                            <option key={pc.id} value={pc.id}>
                                              {pc.code}[{pc.label}]
                                            </option>
                                          ))}
                                        </select>
                                      );
                                    }
                                    // Read-only locked view
                                    if (isMarker && workSeg.payCode) {
                                      return <span className="text-xs text-zinc-700 dark:text-zinc-200">{workSeg.payCode.code}[{workSeg.payCode.label}]</span>;
                                    }
                                    return <span className="text-xs text-red-400 dark:text-red-600">Absent</span>;
                                  }

                                  // Non-working day (weekend or not scheduled): show blank dropdown like REASON.
                                  // Skip this branch when there are actual work segments (e.g. a manually added entry).
                                  if (isWeekend && !workSeg) {
                                    if (canEdit) {
                                      const absentKey = `absent:${dayStr}`;
                                      const absentPending = pendingPayCodes.has(absentKey);
                                      const dayMarker = daySegments.find((s) => s.segmentType === "LEAVE" && s.durationMinutes === 0);
                                      return (
                                        <select
                                          value={absentPending ? (pendingPayCodes.get(absentKey) ?? "") : (dayMarker?.payCode?.id ?? "")}
                                          onChange={(e) => handleAbsentDayPayCodeChange(timecard?.timesheetId ?? null, dayStr, e.target.value)}
                                          className={absentDropdownClass(absentPending)}
                                        >
                                          <option value="">—</option>
                                          {payCodes.map((pc) => (
                                            <option key={pc.id} value={pc.id}>{pc.code}[{pc.label}]</option>
                                          ))}
                                        </select>
                                      );
                                    }
                                    const dayMarker = daySegments.find((s) => s.segmentType === "LEAVE" && s.durationMinutes === 0);
                                    return dayMarker?.payCode
                                      ? <span className="text-xs text-zinc-500">{dayMarker.payCode.code}[{dayMarker.payCode.label}]</span>
                                      : null;
                                  }

                                  // Holiday day: show the HOLIDAY segment's pay code read-only.
                                  // The credit is engine-managed; admin cannot change it here.
                                  if (!workSeg) {
                                    const holidaySeg = daySegments.find((s) => s.segmentType === "HOLIDAY" && s.durationMinutes > 0);
                                    if (holidaySeg?.payCode) {
                                      return <span className="text-xs text-zinc-700 dark:text-zinc-200">{holidaySeg.payCode.code}[{holidaySeg.payCode.label}]</span>;
                                    }
                                  }

                                  // Working day with no segments yet (open punch today, or future day).
                                  // Show an editable blank dropdown so the user can pre-set the code.
                                  if (!workSeg) {
                                    if (canEdit) {
                                      const absentKey = `absent:${dayStr}`;
                                      const absentPending = pendingPayCodes.has(absentKey);
                                      const defaultId = dayPunches.length > 0
                                        ? (timecard?.employee.ruleSet?.defaultPayCodeId ?? "")
                                        : "";
                                      return (
                                        <select
                                          value={absentPending ? (pendingPayCodes.get(absentKey) ?? "") : defaultId}
                                          onChange={(e) =>
                                            handleAbsentDayPayCodeChange(timecard?.timesheetId ?? null, dayStr, e.target.value)
                                          }
                                          className={absentDropdownClass(absentPending)}
                                        >
                                          <option value="">—</option>
                                          {payCodes.map((pc) => (
                                            <option key={pc.id} value={pc.id}>
                                              {pc.code}[{pc.label}]
                                            </option>
                                          ))}
                                        </select>
                                      );
                                    }
                                    return null;
                                  }

                                  const workSegPending = pendingPayCodes.has(workSeg.id);
                                  return canEdit ? (
                                    <select
                                      value={workSegPending ? (pendingPayCodes.get(workSeg.id) ?? "") : (workSeg.payCode?.id ?? "")}
                                      onChange={(e) => handlePayCodeChange(workSeg.id, e.target.value, dayKey)}
                                      className={`w-24 rounded border px-1 py-0.5 text-xs focus:outline-none ${workSegPending ? "border-amber-400 bg-amber-50/50 text-zinc-700 dark:border-amber-600 dark:bg-amber-950/10 dark:text-zinc-300" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
                                    >
                                      <option value="">—</option>
                                      {payCodes.map((pc) => (
                                        <option key={pc.id} value={pc.id}>
                                          {pc.code}[{pc.label}]
                                        </option>
                                      ))}
                                    </select>
                                  ) : workSeg.payCode ? (
                                    <span className="text-xs text-zinc-700 dark:text-zinc-200">
                                      {workSeg.payCode.code}[{workSeg.payCode.label}]
                                    </span>
                                  ) : null;
                                })()}
                              </td>
                            )}

                            {/* Reason code */}
                            {reasonCodes.length > 0 && (
                              <td
                                className="px-2 py-1.5"
                                onClick={(e) => e.stopPropagation()}
                                style={(() => {
                                  const dr = timecard?.dayReasons.find((d) => d.segmentDate === format(day, "yyyy-MM-dd"));
                                  const color = dr?.reasonCode.color;
                                  return color ? { backgroundColor: color + "33" } : undefined;
                                })()}
                              >
                                {(() => {
                                  const dayStr = format(day, "yyyy-MM-dd");
                                  const dayReason = timecard?.dayReasons.find((dr) => dr.segmentDate === dayStr);
                                  const reasonPending = pendingReasonCodes.has(dayStr);
                                  if (canEdit) {
                                    return (
                                      <select
                                        value={reasonPending ? (pendingReasonCodes.get(dayStr) ?? "") : (dayReason?.reasonCodeId ?? "")}
                                        onChange={(e) => handleDayReasonCodeChange(timecard?.timesheetId ?? null, dayStr, e.target.value)}
                                        className={`w-28 rounded border px-1 py-0.5 text-xs focus:outline-none ${reasonPending ? "border-amber-400 bg-amber-50/50 text-zinc-700 dark:border-amber-600 dark:bg-amber-950/10 dark:text-zinc-300" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
                                      >
                                        <option value="">—</option>
                                        {reasonCodes.map((rc) => (
                                          <option key={rc.id} value={rc.id}>
                                            {rc.code}[{rc.label}]
                                          </option>
                                        ))}
                                      </select>
                                    );
                                  }
                                  return dayReason ? (
                                    <span className="text-xs text-zinc-500">{dayReason.reasonCode.code}[{dayReason.reasonCode.label}]</span>
                                  ) : null;
                                })()}
                              </td>
                            )}

                            {/* Notes icon */}
                            <td className="w-7 px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                              {(() => {
                                const dayStr = format(day, "yyyy-MM-dd");
                                // If the day has manual continuation rows, those rows own the amber
                                // indicator — suppress it here so it doesn't double-highlight.
                                const hasManualContinuation = pairs.slice(1).some(
                                  (p) => p.inPunch?.source === "MANUAL" || p.outPunch?.source === "MANUAL"
                                );
                                const allNotes = timecard?.notes.filter((n) => n.noteDate === dayStr).length ?? 0;
                                const dayNoteCount = hasManualContinuation ? 0 : allNotes;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenNote(dayStr)}
                                    title={allNotes > 0 ? `${allNotes} note${allNotes !== 1 ? "s" : ""}` : "Add note"}
                                    className={`relative rounded p-0.5 ${
                                      dayNoteCount > 0
                                        ? "text-amber-500 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                        : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                                    }`}
                                  >
                                    <StickyNote className="h-4 w-4" />
                                    {dayNoteCount > 1 && (
                                      <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                                        {dayNoteCount}
                                      </span>
                                    )}
                                  </button>
                                );
                              })()}
                            </td>

                            {/* In time */}
                            <td className={`px-2 py-1 font-mono text-sm ${
                              isAbsent ? "text-red-700 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"
                            }`} onClick={(e) => e.stopPropagation()}>
                              {addingPunch?.dayKey === dayKey && addingPunch.pairIndex === 0 && addingPunch.punchType === "CLOCK_IN" ? (
                                <InlinePunchEdit
                                  timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                  onTimeChange={setEditTimeStr}
                                  onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                  onBlurSave={handleAddPunchBlur}
                                  onCancel={cancelEditing}
                                />
                              ) : firstIn && editingPunchId === firstIn.id ? (
                                <InlinePunchEdit
                                  timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                  onTimeChange={setEditTimeStr}
                                  onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                  onBlurSave={handleCorrectPunchBlur}
                                  onCancel={cancelEditing}
                                  onDelete={() => deletePunchDirect(firstIn.id)}
                                />
                              ) : firstIn ? (
                                <button
                                  type="button"
                                  onClick={() => startEditing(firstIn)}
                                  disabled={!canEdit}
                                  className={canEdit ? `rounded px-1 py-0.5 ${pendingPunchEdits.has(firstIn.id) ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30" : "hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"}` : ""}
                                >
                                  {pendingPunchEdits.has(firstIn.id) ? format(pendingPunchEdits.get(firstIn.id)!, "h:mm a") : format(parseISO(firstIn.roundedTime), "h:mm a")}
                                </button>
                              ) : (() => {
                                const pendingNewIn = pendingNewPunches.find((p) => p.dayKey === dayKey && p.pairIndex === 0 && p.punchType === "CLOCK_IN");
                                if (pendingNewIn) return (
                                  <div className="flex items-center gap-0.5">
                                    <span className="font-mono text-xs text-amber-600 dark:text-amber-400">{format(pendingNewIn.punchDate, "h:mm a")}</span>
                                    <button type="button" onClick={() => setPendingNewPunches((prev) => prev.filter((p) => !(p.dayKey === dayKey && p.pairIndex === 0 && p.punchType === "CLOCK_IN")))} className="rounded p-0.5 text-zinc-400 hover:text-red-500" title="Remove pending"><X className="h-2.5 w-2.5" /></button>
                                  </div>
                                );
                                return hasMissingPunch && canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startAddingPunch(dayKey, 0, "CLOCK_IN", day, lastOut ? parseISO(lastOut.roundedTime) : null)}
                                    className="rounded px-1 py-0.5 font-medium text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                                  >
                                    Missed
                                  </button>
                                ) : hasMissingPunch ? (
                                  <span className="font-medium text-amber-600 dark:text-amber-400">Missed</span>
                                ) : canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startAddingPunch(dayKey, 0, "CLOCK_IN", day)}
                                    className="rounded px-1 py-0.5 text-zinc-300 hover:bg-blue-50 hover:text-blue-500 dark:text-zinc-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                                  >
                                    —
                                  </button>
                                ) : (
                                  <span className="text-zinc-300 dark:text-zinc-700">—</span>
                                );
                              })()}
                            </td>

                            {/* Out time */}
                            <td className="px-2 py-1 font-mono text-sm text-zinc-700 dark:text-zinc-300" onClick={(e) => e.stopPropagation()}>
                              {addingPunch?.dayKey === dayKey && addingPunch.pairIndex === 0 && addingPunch.punchType === "CLOCK_OUT" ? (
                                <InlinePunchEdit
                                  timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                  onTimeChange={setEditTimeStr}
                                  onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                  onBlurSave={handleAddPunchBlur}
                                  onCancel={cancelEditing}
                                />
                              ) : lastOut && editingPunchId === lastOut.id ? (
                                <InlinePunchEdit
                                  timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                  onTimeChange={setEditTimeStr}
                                  onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                  onBlurSave={handleCorrectPunchBlur}
                                  onCancel={cancelEditing}
                                  onDelete={() => deletePunchDirect(lastOut.id)}
                                />
                              ) : lastOut ? (
                                <button
                                  type="button"
                                  onClick={() => startEditing(lastOut)}
                                  disabled={!canEdit}
                                  className={canEdit ? `rounded px-1 py-0.5 ${pendingPunchEdits.has(lastOut.id) ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30" : "hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"}` : ""}
                                >
                                  {pendingPunchEdits.has(lastOut.id) ? format(pendingPunchEdits.get(lastOut.id)!, "h:mm a") : format(parseISO(lastOut.roundedTime), "h:mm a")}
                                </button>
                              ) : (() => {
                                const pendingNewOut = pendingNewPunches.find((p) => p.dayKey === dayKey && p.pairIndex === 0 && p.punchType === "CLOCK_OUT");
                                if (pendingNewOut) return (
                                  <div className="flex items-center gap-0.5">
                                    <span className="font-mono text-xs text-amber-600 dark:text-amber-400">{format(pendingNewOut.punchDate, "h:mm a")}</span>
                                    <button type="button" onClick={() => setPendingNewPunches((prev) => prev.filter((p) => !(p.dayKey === dayKey && p.pairIndex === 0 && p.punchType === "CLOCK_OUT")))} className="rounded p-0.5 text-zinc-400 hover:text-red-500" title="Remove pending"><X className="h-2.5 w-2.5" /></button>
                                  </div>
                                );
                                return hasMissingPunch && canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startAddingPunch(dayKey, 0, "CLOCK_OUT", day, firstIn ? parseISO(firstIn.roundedTime) : null)}
                                    className="rounded px-1 py-0.5 font-medium text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                                  >
                                    Missed
                                  </button>
                                ) : hasMissingPunch ? (
                                  <span className="font-medium text-amber-600 dark:text-amber-400">Missed</span>
                                ) : canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startAddingPunch(dayKey, 0, "CLOCK_OUT", day)}
                                    className="rounded px-1 py-0.5 text-zinc-300 hover:bg-blue-50 hover:text-blue-500 dark:text-zinc-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                                  >
                                    —
                                  </button>
                                ) : null;
                              })()}
                            </td>

                            {/* Reg */}
                            {(() => {
                              const canAddHours = canEdit && timecard && dayPunches.length === 0 && reg === 0 && !isSalaryVirtualDay && !isTodayRow;
                              const isEditingThis = editingHours?.dayKey === dayKey;
                              const pendingHours = pendingHoursEntries.find((e) => e.dayKey === dayKey)?.hours;
                              return (
                                <td
                                  className={`px-3 py-1.5 text-right tabular-nums text-sm ${
                                    isAbsent
                                      ? "text-red-400 dark:text-red-700"
                                      : hasMissingPunch
                                        ? "text-amber-400 dark:text-amber-600"
                                        : (reg > 0 || isSalaryVirtualDay)
                                          ? "text-zinc-700 dark:text-zinc-300"
                                          : "text-zinc-300 dark:text-zinc-700"
                                  }`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {isEditingThis ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="text"
                                          autoFocus
                                          value={editingHours.value}
                                          onChange={(e) => setEditingHours({ dayKey, value: e.target.value })}
                                          onBlur={handleHoursBlur}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") { e.preventDefault(); handleHoursBlur(); }
                                            if (e.key === "Escape") { e.preventDefault(); setEditingHours(null); setHoursError(null); }
                                          }}
                                          placeholder="0.00"
                                          className="w-14 rounded border border-blue-400 bg-white px-1 py-0.5 text-right text-xs dark:border-blue-600 dark:bg-zinc-800 dark:text-white"
                                        />
                                        <span className="text-xs text-zinc-400">h</span>
                                      </div>
                                      {hoursError && <span className="text-xs text-red-500">{hoursError}</span>}
                                    </div>
                                  ) : pendingHours !== undefined ? (
                                    <span className="font-medium text-amber-500 dark:text-amber-400">{pendingHours.toFixed(2)}</span>
                                  ) : canAddHours ? (
                                    <button
                                      type="button"
                                      title="Add manual hours"
                                      onClick={() => { setEditingHours({ dayKey, value: "" }); setHoursError(null); }}
                                      className={`rounded px-1 py-0.5 ${isAbsent ? "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 dark:hover:text-red-400" : "hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}
                                    >
                                      {isAbsent ? "0.00" : "—"}
                                    </button>
                                  ) : (
                                    isAbsent ? "0.00" : hasMissingPunch ? "—" : (reg > 0 || isSalaryVirtualDay) ? minutesToHoursDecimal(reg || SALARY_VIRTUAL_MINS) : "—"
                                  )}
                                </td>
                              );
                            })()}

                            {/* OT */}
                            <td className={`px-3 py-1.5 text-right tabular-nums text-sm ${
                              isAbsent
                                ? "text-red-400 dark:text-red-700"
                                : hasMissingPunch
                                  ? "text-amber-400 dark:text-amber-600"
                                  : ot > 0
                                    ? "font-semibold text-amber-600 dark:text-amber-400"
                                    : "text-zinc-300 dark:text-zinc-700"
                            }`}>
                              {hasMissingPunch ? "—" : ot > 0 ? minutesToHoursDecimal(ot) : "—"}
                            </td>

                            {/* DT */}
                            <td className={`px-3 py-1.5 text-right tabular-nums text-sm ${
                              isAbsent
                                ? "text-red-400 dark:text-red-700"
                                : hasMissingPunch
                                  ? "text-amber-400 dark:text-amber-600"
                                  : dt > 0
                                    ? "font-semibold text-red-600 dark:text-red-400"
                                    : "text-zinc-300 dark:text-zinc-700"
                            }`}>
                              {hasMissingPunch ? "—" : dt > 0 ? minutesToHoursDecimal(dt) : "—"}
                            </td>

                            {/* Total */}
                            <td className={`pl-3 pr-8 py-1.5 text-right tabular-nums text-sm ${
                              isAbsent
                                ? "font-bold text-red-800 dark:text-red-300"
                                : hasMissingPunch
                                  ? "font-bold text-amber-500 dark:text-amber-500"
                                  : (dailyTotal > 0 || isSalaryVirtualDay)
                                    ? "font-bold text-zinc-900 dark:text-white"
                                    : "text-zinc-300 dark:text-zinc-700"
                            }`}>
                              {isAbsent ? "0.00" : hasMissingPunch ? "—" : (dailyTotal > 0 || isSalaryVirtualDay) ? minutesToHoursDecimal(dailyTotal || SALARY_VIRTUAL_MINS) : "—"}
                            </td>

                            {/* Meal waiver cell — auto-deduct waiver OR meal premium waiver */}
                            {showMealColumn && (() => {
                              if (effectiveAutoDeductMeal) {
                                const rawWorkMins = daySegments.filter((s) => s.segmentType === "WORK").reduce((a, s) => a + s.durationMinutes, 0);
                                const mealSeg = daySegments.find((s) => s.segmentType === "MEAL");
                                const totalWorkForThreshold = rawWorkMins + (mealSeg?.durationMinutes ?? 0);
                                const dbWaiver = timecard?.mealWaivers.find((w) => w.segmentDate === dayStr);
                                const waiverToggled = pendingWaiverToggles.has(dayStr);
                                const effectiveHasWaiver = waiverToggled ? !dbWaiver : !!dbWaiver;
                                return (
                                  <td className="px-3 py-1 text-left" onClick={(e) => e.stopPropagation()}>
                                    {totalWorkForThreshold <= effectiveMealBreakAfterMinutes ? (
                                      <span className="text-xs text-zinc-300 dark:text-zinc-700">—</span>
                                    ) : effectiveHasWaiver ? (
                                      <div className="flex items-center gap-1.5">
                                        {canEdit ? (
                                          <button
                                            type="button"
                                            onClick={() => handleToggleWaiver(dayStr)}
                                            title="Click to remove waiver"
                                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${waiverToggled ? "bg-amber-200 text-amber-800 hover:bg-red-100 hover:text-red-600 dark:bg-amber-800/40 dark:text-amber-300 dark:hover:bg-red-900/30 dark:hover:text-red-400" : "bg-amber-100 text-amber-700 hover:bg-red-100 hover:text-red-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-red-900/30 dark:hover:text-red-400"}`}
                                          >
                                            {waiverToggled ? "Waived*" : "Waived"}
                                          </button>
                                        ) : (
                                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                            Waived
                                          </span>
                                        )}
                                        {waiverError && <span className="text-xs text-red-500">{waiverError}</span>}
                                      </div>
                                    ) : canEdit ? (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => handleToggleWaiver(dayStr)}
                                          className={`rounded px-2 py-0.5 text-xs ${waiverToggled ? "bg-amber-100 text-amber-700 hover:bg-zinc-100 hover:text-zinc-600 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" : "bg-zinc-100 text-zinc-600 hover:bg-amber-50 hover:text-amber-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-amber-900/20 dark:hover:text-amber-300"}`}
                                        >
                                          {waiverToggled ? "Waive*" : "Waive"}
                                        </button>
                                        {waiverError && <span className="text-xs text-red-500">{waiverError}</span>}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-zinc-300 dark:text-zinc-700">—</span>
                                    )}
                                  </td>
                                );
                              }
                              // Meal premium waiver — individual buttons are on each MEAL_PREMIUM row
                              return <td className="px-3 py-1 text-left"><span className="text-xs text-zinc-300 dark:text-zinc-700">—</span></td>;
                            })()}

                            {/* Delete manual pair — main row (first pair) */}
                            {canDeleteManual && (() => {
                              const isManualPair = firstIn?.source === "MANUAL" && lastOut?.source === "MANUAL";
                              const punchIds = [firstIn?.id, lastOut?.id].filter(Boolean) as string[];
                              const inTime = firstIn ? format(parseISO(firstIn.roundedTime), "h:mm a") : null;
                              const outTime = lastOut ? format(parseISO(lastOut.roundedTime), "h:mm a") : null;
                              const isPendingDelete = pendingDeletions.some((d) => d.punchIds.join(",") === punchIds.join(","));
                              return (
                                <td className="w-8 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                                  {isManualPair && punchIds.length > 0 && (
                                    <button
                                      type="button"
                                      disabled={isPending}
                                      onClick={() => queueDeleteManualPair(punchIds, dayKey, inTime, outTime)}
                                      title={isPendingDelete ? "Undo delete" : "Delete manual entry"}
                                      className={`rounded p-0.5 disabled:opacity-50 ${isPendingDelete ? "text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" : "text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </td>
                              );
                            })()}
                          </tr>

                          {/* Continuation rows for additional punch pairs on the same day */}
                          {pairs.slice(1).map((pair, sliceIdx) => {
                            const pairIdx = sliceIdx + 1;
                            const pairIn = pair.inPunch;
                            const pairOut = pair.outPunch;
                            const pairWorkSeg = daySegments.find((s) => {
                              if (s.segmentType !== "WORK") return false;
                              const sStart = new Date(s.startTime).getTime();
                              // truncate to minute — computeSegments uses truncToMin on roundedTime,
                              // so sStart may be up to 59s earlier than the raw roundedTime
                              const inMs = pairIn ? Math.floor(new Date(pairIn.roundedTime).getTime() / 60_000) * 60_000 : 0;
                              const outMs = pairOut ? new Date(pairOut.roundedTime).getTime() : Infinity;
                              return sStart >= inMs && sStart < outMs;
                            }) ?? null;
                            return (
                              <tr
                                key={`${dayKey}-pair${pairIdx}`}
                                className="border-b border-zinc-200 dark:border-zinc-700"
                              >
                                {/* Empty chevron */}
                                <td className="w-7 pl-2 pr-0" />
                                {/* Continuation date indicator */}
                                <td className="px-3 py-1 text-xs text-zinc-400 dark:text-zinc-600">
                                  <span className="ml-4 text-zinc-300 dark:text-zinc-700">↳</span>
                                </td>
                                {/* Pay code DB cell */}
                                {payCodes.length > 0 && (
                                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                    {pairWorkSeg && canEdit ? (
                                      <select
                                        value={pendingPayCodes.has(pairWorkSeg.id) ? (pendingPayCodes.get(pairWorkSeg.id) ?? "") : (pairWorkSeg.payCode?.id ?? "")}
                                        onChange={(e) => handlePayCodeChange(pairWorkSeg.id, e.target.value, dayKey)}
                                        className={`w-24 rounded border px-1 py-0.5 text-xs focus:outline-none ${pendingPayCodes.has(pairWorkSeg.id) ? "border-amber-400 bg-amber-50/50 text-zinc-700 dark:border-amber-600 dark:bg-amber-950/10 dark:text-zinc-300" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
                                      >
                                        <option value="">—</option>
                                        {payCodes.map((pc) => (
                                          <option key={pc.id} value={pc.id}>
                                            {pc.code}[{pc.label}]
                                          </option>
                                        ))}
                                      </select>
                                    ) : pairWorkSeg?.payCode ? (
                                      <span className="text-xs text-zinc-700 dark:text-zinc-200">
                                        {pairWorkSeg.payCode.code}[{pairWorkSeg.payCode.label}]
                                      </span>
                                    ) : canEdit ? (() => {
                                      const absentKey = `absent:${dayKey}`;
                                      const absentPending = pendingPayCodes.has(absentKey);
                                      const dayMarker = daySegments.find((s) => s.segmentType === "LEAVE" && s.durationMinutes === 0);
                                      return (
                                        <select
                                          value={absentPending ? (pendingPayCodes.get(absentKey) ?? "") : (pairWorkSeg?.payCode?.id ?? dayMarker?.payCode?.id ?? "")}
                                          onChange={(e) => handleAbsentDayPayCodeChange(timecard?.timesheetId ?? null, dayKey, e.target.value)}
                                          className={`w-24 rounded border px-1 py-0.5 text-xs focus:outline-none ${absentPending ? "border-amber-400 bg-amber-50/50 text-zinc-700 dark:border-amber-600 dark:bg-amber-950/10 dark:text-zinc-300" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
                                        >
                                          <option value="">—</option>
                                          {payCodes.map((pc) => (
                                            <option key={pc.id} value={pc.id}>
                                              {pc.code}[{pc.label}]
                                            </option>
                                          ))}
                                        </select>
                                      );
                                    })() : null}
                                  </td>
                                )}
                                {/* Reason code — day-level, shown only on first row; blank cell for continuations */}
                                {reasonCodes.length > 0 && <td className="px-2 py-1.5" />}
                                {/* Notes icon — shown only on manual continuation rows */}
                                <td className="w-7 px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                                  {(() => {
                                    const isManualPair = pairIn?.source === "MANUAL" || pairOut?.source === "MANUAL";
                                    if (!isManualPair) return null;
                                    const contDayStr = format(day, "yyyy-MM-dd");
                                    const contNoteCount = timecard?.notes.filter((n) => n.noteDate === contDayStr).length ?? 0;
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenNote(contDayStr)}
                                        title={contNoteCount > 0 ? `${contNoteCount} note${contNoteCount !== 1 ? "s" : ""}` : "Add note"}
                                        className={`relative rounded p-0.5 ${
                                          contNoteCount > 0
                                            ? "text-amber-500 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                            : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                                        }`}
                                      >
                                        <StickyNote className="h-4 w-4" />
                                      </button>
                                    );
                                  })()}
                                </td>
                                {/* In cell */}
                                <td className="px-2 py-1 font-mono text-sm text-zinc-700 dark:text-zinc-300" onClick={(e) => e.stopPropagation()}>
                                  {addingPunch?.dayKey === dayKey && addingPunch.pairIndex === pairIdx && addingPunch.punchType === "CLOCK_IN" ? (
                                    <InlinePunchEdit
                                      timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                      onTimeChange={setEditTimeStr}
                                      onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                      onBlurSave={handleAddPunchBlur}
                                      onCancel={cancelEditing}
                                    />
                                  ) : pairIn && editingPunchId === pairIn.id ? (
                                    <InlinePunchEdit
                                      timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                      onTimeChange={setEditTimeStr}
                                      onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                      onBlurSave={handleCorrectPunchBlur}
                                      onCancel={cancelEditing}
                                      onDelete={() => deletePunchDirect(pairIn.id)}
                                    />
                                  ) : pairIn ? (
                                    <button type="button" onClick={() => startEditing(pairIn)} disabled={!canEdit} className={canEdit ? `rounded px-1 py-0.5 ${pendingPunchEdits.has(pairIn.id) ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30" : "hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"}` : ""}>{pendingPunchEdits.has(pairIn.id) ? format(pendingPunchEdits.get(pairIn.id)!, "h:mm a") : format(parseISO(pairIn.roundedTime), "h:mm a")}</button>
                                  ) : (() => {
                                    const pendingNewPairIn = pendingNewPunches.find((p) => p.dayKey === dayKey && p.pairIndex === pairIdx && p.punchType === "CLOCK_IN");
                                    if (pendingNewPairIn) return (
                                      <div className="flex items-center gap-0.5">
                                        <span className="font-mono text-xs text-amber-600 dark:text-amber-400">{format(pendingNewPairIn.punchDate, "h:mm a")}</span>
                                        <button type="button" onClick={() => setPendingNewPunches((prev) => prev.filter((p) => !(p.dayKey === dayKey && p.pairIndex === pairIdx && p.punchType === "CLOCK_IN")))} className="rounded p-0.5 text-zinc-400 hover:text-red-500" title="Remove pending"><X className="h-2.5 w-2.5" /></button>
                                      </div>
                                    );
                                    return canEdit ? (
                                      <button type="button" onClick={() => startAddingPunch(dayKey, pairIdx, "CLOCK_IN", day)} className="rounded px-1 py-0.5 text-zinc-300 hover:bg-blue-50 hover:text-blue-500 dark:text-zinc-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-400">—</button>
                                    ) : (
                                      <span className="text-zinc-300 dark:text-zinc-700">—</span>
                                    );
                                  })()}
                                </td>
                                {/* Out cell */}
                                <td className="px-2 py-1 font-mono text-sm text-zinc-700 dark:text-zinc-300" onClick={(e) => e.stopPropagation()}>
                                  {addingPunch?.dayKey === dayKey && addingPunch.pairIndex === pairIdx && addingPunch.punchType === "CLOCK_OUT" ? (
                                    <InlinePunchEdit
                                      timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                      onTimeChange={setEditTimeStr}
                                      onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                      onBlurSave={handleAddPunchBlur}
                                      onCancel={cancelEditing}
                                    />
                                  ) : pairOut && editingPunchId === pairOut.id ? (
                                    <InlinePunchEdit
                                      timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                      onTimeChange={setEditTimeStr}
                                      onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                      onBlurSave={handleCorrectPunchBlur}
                                      onCancel={cancelEditing}
                                      onDelete={() => deletePunchDirect(pairOut.id)}
                                    />
                                  ) : pairOut ? (
                                    <button type="button" onClick={() => startEditing(pairOut)} disabled={!canEdit} className={canEdit ? `rounded px-1 py-0.5 ${pendingPunchEdits.has(pairOut.id) ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30" : "hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"}` : ""}>{pendingPunchEdits.has(pairOut.id) ? format(pendingPunchEdits.get(pairOut.id)!, "h:mm a") : format(parseISO(pairOut.roundedTime), "h:mm a")}</button>
                                  ) : (() => {
                                    const pendingNewPairOut = pendingNewPunches.find((p) => p.dayKey === dayKey && p.pairIndex === pairIdx && p.punchType === "CLOCK_OUT");
                                    if (pendingNewPairOut) return (
                                      <div className="flex items-center gap-0.5">
                                        <span className="font-mono text-xs text-amber-600 dark:text-amber-400">{format(pendingNewPairOut.punchDate, "h:mm a")}</span>
                                        <button type="button" onClick={() => setPendingNewPunches((prev) => prev.filter((p) => !(p.dayKey === dayKey && p.pairIndex === pairIdx && p.punchType === "CLOCK_OUT")))} className="rounded p-0.5 text-zinc-400 hover:text-red-500" title="Remove pending"><X className="h-2.5 w-2.5" /></button>
                                      </div>
                                    );
                                    if (hasMissingPunch) {
                                      return canEdit ? (
                                        <button type="button" onClick={() => startAddingPunch(dayKey, pairIdx, "CLOCK_OUT", day, pairIn ? parseISO(pairIn.roundedTime) : null)} className="rounded px-1 py-0.5 font-medium text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30">Missed</button>
                                      ) : (
                                        <span className="font-medium text-amber-600 dark:text-amber-400">Missed</span>
                                      );
                                    }
                                    return canEdit ? (
                                      <button type="button" onClick={() => startAddingPunch(dayKey, pairIdx, "CLOCK_OUT", day)} className="rounded px-1 py-0.5 text-zinc-300 hover:bg-blue-50 hover:text-blue-500 dark:text-zinc-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-400">—</button>
                                    ) : null;
                                  })()}
                                </td>
                                {/* Hours: blank for continuation rows */}
                                <td className="px-3 py-1.5 text-right text-zinc-300 dark:text-zinc-700 text-sm">—</td>
                                <td className="px-3 py-1.5 text-right text-zinc-300 dark:text-zinc-700 text-sm">—</td>
                                <td className="px-3 py-1.5 text-right text-zinc-300 dark:text-zinc-700 text-sm">—</td>
                                <td className="pl-3 pr-8 py-1.5 text-right text-zinc-300 dark:text-zinc-700 text-sm">—</td>
                                {showMealColumn && <td />}
                                {/* Delete manual pair — continuation row */}
                                {canDeleteManual && (() => {
                                  const isManualPair = pairIn?.source === "MANUAL" && pairOut?.source === "MANUAL";
                                  const punchIds = [pairIn?.id, pairOut?.id].filter(Boolean) as string[];
                                  const inTime = pairIn ? format(parseISO(pairIn.roundedTime), "h:mm a") : null;
                                  const outTime = pairOut ? format(parseISO(pairOut.roundedTime), "h:mm a") : null;
                                  const isPendingDelete = pendingDeletions.some((d) => d.punchIds.join(",") === punchIds.join(","));
                                  return (
                                    <td className="w-8 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                                      {isManualPair && punchIds.length > 0 && (
                                        <button
                                          type="button"
                                          disabled={isPending}
                                          onClick={() => queueDeleteManualPair(punchIds, dayKey, inTime, outTime)}
                                          title={isPendingDelete ? "Undo delete" : "Delete manual entry"}
                                          className={`rounded p-0.5 disabled:opacity-50 ${isPendingDelete ? "text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" : "text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"}`}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </td>
                                  );
                                })()}
                              </tr>
                            );
                          })}

                          {/* Leave rows — one per leave segment, shown only when expanded */}
                          {isExpanded && leaveSegments.map((seg) => (
                            <tr key={`${dayKey}-leave-${seg.id}`} className="border-b border-zinc-100 bg-violet-50/30 dark:border-zinc-800 dark:bg-violet-950/10">
                              <td className="w-7 pl-2 pr-0 py-1.5" />
                              <td className="px-3 py-1 text-left">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 pl-2 pr-1 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                                  {seg.leaveRequest?.leaveType.name ?? PAY_BUCKET_LABEL[seg.payBucket as PayBucketValue] ?? seg.payBucket}
                                  {canEdit && seg.leaveRequest?.id && (
                                    <button
                                      type="button"
                                      disabled={isPending}
                                      onClick={() => handleRemoveLeave(seg.leaveRequest!.id)}
                                      className="rounded-full p-0.5 hover:bg-violet-200 disabled:opacity-50 dark:hover:bg-violet-800"
                                      title="Remove leave entry"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  )}
                                </span>
                              </td>
                              {payCodes.length > 0 && (() => {
                                const leavePayCode = seg.payCode ?? seg.leaveRequest?.leaveType.payCode ?? null;
                                return (
                                  <td className="px-2 py-1">
                                    {leavePayCode ? (
                                      <span className="text-xs text-zinc-500">
                                        {leavePayCode.code}[{leavePayCode.label}]
                                      </span>
                                    ) : (
                                      <span className="text-xs text-zinc-300 dark:text-zinc-700">—</span>
                                    )}
                                  </td>
                                );
                              })()}
                              {reasonCodes.length > 0 && <td className="px-2 py-1.5" />}
                              <td className="w-7 px-1 py-1.5" />
                              <td className="px-2 py-1 font-mono text-sm text-zinc-300 dark:text-zinc-700">—</td>
                              <td className="px-2 py-1 font-mono text-sm text-zinc-300 dark:text-zinc-700">—</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-sm font-medium text-violet-700 dark:text-violet-300">
                                {minutesToHoursDecimal(seg.durationMinutes)}
                              </td>
                              <td className="px-3 py-1.5 text-right text-zinc-300 dark:text-zinc-700 text-sm">—</td>
                              <td className="px-3 py-1.5 text-right text-zinc-300 dark:text-zinc-700 text-sm">—</td>
                              <td className="pl-3 pr-8 py-1.5 text-right tabular-nums text-sm font-bold text-violet-700 dark:text-violet-300">
                                {minutesToHoursDecimal(seg.durationMinutes)}
                              </td>
                              {showMealColumn && <td />}
                              {canDeleteManual && <td className="w-8 px-1" />}
                            </tr>
                          ))}

                          {/* Meal premium rows — one per MEAL_PREMIUM segment, always visible as a standalone row */}
                          {daySegments.filter(s => s.segmentType === "MEAL_PREMIUM").map((seg) => (
                            <tr key={`${dayKey}-premium-${seg.id}`} className="border-b border-zinc-100 bg-amber-50/40 dark:border-zinc-800 dark:bg-amber-950/10">
                              <td className="w-7 pl-2 pr-0 py-1.5" />
                              <td className="px-3 py-1 text-left">
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                  Meal Premium
                                </span>
                              </td>
                              {payCodes.length > 0 && (
                                <td className="px-2 py-1">
                                  {seg.payCode ? (
                                    <span className="text-xs text-zinc-500">{seg.payCode.code}[{seg.payCode.label}]</span>
                                  ) : (
                                    <span className="text-xs text-zinc-300 dark:text-zinc-700">—</span>
                                  )}
                                </td>
                              )}
                              {reasonCodes.length > 0 && <td className="px-2 py-1.5" />}
                              <td className="w-7 px-1 py-1.5" />
                              <td className="px-2 py-1 font-mono text-sm text-zinc-300 dark:text-zinc-700">—</td>
                              <td className="px-2 py-1 font-mono text-sm text-zinc-300 dark:text-zinc-700">—</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-sm font-medium text-amber-700 dark:text-amber-300">
                                {minutesToHoursDecimal(seg.durationMinutes)}
                              </td>
                              <td className="px-3 py-1.5 text-right text-zinc-300 dark:text-zinc-700 text-sm">—</td>
                              <td className="px-3 py-1.5 text-right text-zinc-300 dark:text-zinc-700 text-sm">—</td>
                              <td className="pl-3 pr-8 py-1.5 text-right tabular-nums text-sm font-bold text-amber-700 dark:text-amber-300">
                                {minutesToHoursDecimal(seg.durationMinutes)}
                              </td>
                              {showMealColumn && (() => {
                                const segStart = seg.startTime;
                                const premiumDbWaived = timecard?.mealPremiumWaivers.some(w => w.segmentStart === segStart) ?? false;
                                const premiumToggled = pendingPremiumWaiverToggles.has(segStart);
                                const premiumEffectiveWaived = premiumToggled ? !premiumDbWaived : premiumDbWaived;
                                if (effectiveAutoDeductMeal) return <td />;
                                return (
                                  <td className="px-3 py-1 text-left" onClick={(e) => e.stopPropagation()}>
                                    {premiumEffectiveWaived ? (
                                      canEdit ? (
                                        <button type="button" onClick={() => handleTogglePremiumWaiver(segStart, dayKey)} title="Click to remove waiver"
                                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${premiumToggled ? "bg-amber-200 text-amber-800 hover:bg-red-100 hover:text-red-600 dark:bg-amber-800/40 dark:text-amber-300 dark:hover:bg-red-900/30 dark:hover:text-red-400" : "bg-amber-100 text-amber-700 hover:bg-red-100 hover:text-red-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-red-900/30 dark:hover:text-red-400"}`}>
                                          {premiumToggled ? "Waived*" : "Waived"}
                                        </button>
                                      ) : (
                                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Waived</span>
                                      )
                                    ) : canEdit ? (
                                      <button type="button" onClick={() => handleTogglePremiumWaiver(segStart, dayKey)}
                                        className={`rounded px-2 py-0.5 text-xs ${premiumToggled ? "bg-amber-100 text-amber-700 hover:bg-zinc-100 hover:text-zinc-600 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" : "bg-zinc-100 text-zinc-600 hover:bg-amber-50 hover:text-amber-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-amber-900/20 dark:hover:text-amber-300"}`}>
                                        {premiumToggled ? "Waive*" : "Waive"}
                                      </button>
                                    ) : (
                                      <span className="text-xs text-zinc-300 dark:text-zinc-700">—</span>
                                    )}
                                  </td>
                                );
                              })()}
                              {canDeleteManual && <td className="w-8 px-1" />}
                            </tr>
                          ))}

                          {/* Add entry form row */}
                          {addEntryDay === format(day, "yyyy-MM-dd") && (
                            <tr key={`${dayKey}-add`}>
                              <td colSpan={colCount} className="px-4 py-2">
                                <AddTimecardEntry
                                  timesheetId={timecard?.timesheetId ?? ""}
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


                          {/* Expanded punch detail row — only when there are actual punches */}
                          {isExpanded && hasActivity && dayPunches.length > 0 && (
                            <tr
                              key={`${dayKey}-detail`}
                              className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/40"
                            >
                              <td colSpan={colCount} className="px-5 py-2">
                                <div className="flex flex-wrap items-start gap-2">
                                  {dayPunches
                                    .filter((p) => !pairs.some((pr) => pr.inPunch?.id === p.id || pr.outPunch?.id === p.id))
                                    .map((punch) =>
                                      editingPunchId === punch.id ? (
                                        <div
                                          key={punch.id}
                                          className="flex w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950/30"
                                        >
                                          <span className="shrink-0 text-xs font-medium text-blue-800 dark:text-blue-300">
                                            {PUNCH_TYPE_LABEL[punch.punchType as PunchTypeValue] ?? punch.punchType}
                                          </span>
                                          <InlinePunchEdit
                                            timeStr={editTimeStr} amPm={editAmPm} error={editError} isPending={isPending}
                                            onTimeChange={setEditTimeStr}
                                            onAmPmToggle={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
                                            onBlurSave={handleCorrectPunchBlur}
                                            onCancel={cancelEditing}
                                            onDelete={() => deletePunchDirect(punch.id)}
                                          />
                                        </div>
                                      ) : (
                                        <button
                                          key={punch.id}
                                          type="button"
                                          onClick={() => startEditing(punch)}
                                          disabled={!canEdit}
                                          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
                                            canEdit
                                              ? pendingPunchEdits.has(punch.id)
                                                ? "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/20 dark:text-amber-400 dark:hover:bg-amber-950/30"
                                                : "bg-zinc-100 text-zinc-700 hover:bg-blue-50 hover:text-blue-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                                              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
                                          }`}
                                        >
                                          {PUNCH_TYPE_LABEL[punch.punchType as PunchTypeValue] ?? punch.punchType}{" "}
                                          {pendingPunchEdits.has(punch.id) ? format(pendingPunchEdits.get(punch.id)!, "h:mm a") : format(parseISO(punch.roundedTime), "h:mm a")}
                                          {canEdit && <Pencil className="h-2.5 w-2.5" />}
                                        </button>
                                      )
                                    )}
                                </div>


                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    });
                    })()}

                  </tbody>
                </table>
              </div>
              <div className="shrink-0">

                {/* ── Color Legend ──────────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-4 border-t-4 border-zinc-400 bg-zinc-200 px-4 py-2 dark:border-zinc-500 dark:bg-zinc-800/80">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Legend:</span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="inline-block h-3 w-3 rounded border border-amber-500 bg-amber-200 dark:border-amber-700 dark:bg-amber-950/30" />
                    Exception
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="inline-block h-3 w-3 rounded border border-red-500 bg-red-300 dark:border-red-800 dark:bg-red-950/40" />
                    Absent
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="inline-block h-3 w-3 rounded border border-blue-500 bg-blue-200 dark:border-blue-700 dark:bg-blue-950/20" />
                    Today
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="inline-block h-3 w-3 rounded border border-zinc-500 bg-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/40" />
                    Weekend
                  </span>
                </div>

                {/* ── Summary with Group By ──────────────────────────── */}
                <div className="border-t border-zinc-200 dark:border-zinc-800">
                  {/* Summary header with Group By selector */}
                  <div className="flex items-center justify-between bg-zinc-50 px-4 py-1 dark:bg-zinc-900">
                    <span className="text-xs font-medium text-zinc-500">
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
                        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
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
                              (timecard?.overtimeBuckets ?? []).map((b) => [
                                b.bucket,
                                b.totalMinutes,
                              ])
                            );

                          // Dates with a MISSING_PUNCH exception — segments on these days
                          // are excluded from totals since the hours are unreliable.
                          const missingPunchDates = new Set(
                            (timecard?.exceptions ?? [])
                              .filter((e) => e.exceptionType === "MISSING_PUNCH")
                              .map((e) => format(parseISO(e.occurredAt), "yyyy-MM-dd"))
                          );

                          if (summaryGroupBy === "total") {
                            // Recompute from segments so missing-punch days are excluded
                            const filteredBucketMap: Record<string, number> = {};
                            for (const s of (timecard?.segments ?? [])) {
                              if (!s.isPaid) continue;
                              const sd = format(parseUtcDate(s.segmentDate), "yyyy-MM-dd");
                              if (missingPunchDates.has(sd)) continue;
                              const eb = (s.payBucketOverride && !["REG", "OT", "DT"].includes(s.payBucketOverride))
                                ? s.payBucketOverride
                                : s.payBucket;
                              filteredBucketMap[eb] = (filteredBucketMap[eb] ?? 0) + s.durationMinutes;
                            }
                            const paidLeaveMinutes = Object.entries(filteredBucketMap)
                              .filter(([k]) => PAID_LEAVE_BUCKETS.has(k))
                              .reduce((s, [, v]) => s + v, 0);
                            const reg = (filteredBucketMap["REG"] ?? 0) + paidLeaveMinutes;
                            const ot = filteredBucketMap["OT"] ?? 0;
                            const dt = filteredBucketMap["DT"] ?? 0;
                            const total = Object.values(filteredBucketMap).reduce(
                              (a, b) => a + b,
                              0
                            );
                            return (
                              <SummaryRow
                                label="Totals"
                                reg={reg}
                                ot={ot}
                                dt={dt}
                                total={total}
                                rate={rate}
                                isBold
                              />
                            );
                          }

                          if (summaryGroupBy === "week") {
                            // Split by week within the pay period
                            const periodEntry = timecard ? timecard.payPeriod : sortedPeriods.find((p) => p.id === selectedPeriodId);
                            if (!periodEntry) return null;
                            const ppStart = parseUtcDate(periodEntry.startDate);
                            const ppEnd = addDays(parseUtcDate(periodEntry.endDate), -1);
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
                                  const weekSegs = (timecard?.segments ?? []).filter(
                                    (s) => {
                                      const sd = parseUtcDate(s.segmentDate);
                                      return sd >= week.start && sd <= week.end
                                        && !missingPunchDates.has(format(sd, "yyyy-MM-dd"));
                                    }
                                  );
                                  const weekBuckets: Record<string, number> =
                                    {};
                                  for (const s of weekSegs) {
                                    if (s.isPaid) {
                                      const eb = (s.payBucketOverride && !["REG", "OT", "DT"].includes(s.payBucketOverride))
                                        ? s.payBucketOverride
                                        : s.payBucket;
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
                            { label: string; reg: number; ot: number; dt: number; total: number }
                          > = {};
                          for (const seg of (timecard?.segments ?? [])) {
                            if (!seg.isPaid) continue;
                            const sd = format(parseUtcDate(seg.segmentDate), "yyyy-MM-dd");
                            if (missingPunchDates.has(sd)) continue;
                            const eb = (seg.payBucketOverride && !["REG", "OT", "DT"].includes(seg.payBucketOverride))
                              ? seg.payBucketOverride
                              : seg.payBucket;
                            const key =
                              seg.payCode
                                ? `${seg.payCode.code}[${seg.payCode.label}]`
                                : PAY_BUCKET_LABEL[eb as PayBucketValue] ?? eb;
                            byCode[key] = byCode[key] ?? { label: key, reg: 0, ot: 0, dt: 0, total: 0 };
                            byCode[key].total += seg.durationMinutes;
                            if (eb === "REG" || PAID_LEAVE_BUCKETS.has(eb)) {
                              byCode[key].reg += seg.durationMinutes;
                            } else if (eb === "OT") {
                              byCode[key].ot += seg.durationMinutes;
                            } else if (eb === "DT") {
                              byCode[key].dt += seg.durationMinutes;
                            }
                          }
                          let grandReg = 0, grandOt = 0, grandDt = 0, grandTotal = 0;
                          for (const e of Object.values(byCode)) {
                            grandReg += e.reg; grandOt += e.ot; grandDt += e.dt; grandTotal += e.total;
                          }

                          return (
                            <>
                              {Object.values(byCode).map((entry) => (
                                <SummaryRow
                                  key={entry.label}
                                  label={entry.label}
                                  reg={entry.reg}
                                  ot={entry.ot}
                                  dt={entry.dt}
                                  total={entry.total}
                                  rate={rate}
                                />
                              ))}
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

      {/* Notes Modal */}
      {noteDay && timecard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { setNoteDay(null); setNoteText(""); }}
        >
          <div
            className="flex w-full max-w-lg flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-700">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Notes</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {(() => {
                    try { return format(parseISO(noteDay), "EEE MM/dd/yyyy"); } catch { return noteDay; }
                  })()}
                  {" · "}{timecard.employee.user?.name ?? timecard.employee.employeeCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setNoteDay(null); setNoteText(""); }}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Notes list */}
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const dayNotes = (timecard?.notes ?? []).filter((n) => n.noteDate === noteDay);
                if (dayNotes.length === 0) {
                  return (
                    <p className="px-5 py-6 text-center text-sm text-zinc-400">
                      No notes yet for this date.
                    </p>
                  );
                }
                return (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {dayNotes.map((n) => (
                      <div key={n.id} className="px-5 py-3.5">
                        <div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
                          <span className="font-medium text-zinc-600 dark:text-zinc-300">
                            {n.createdByName ?? "Unknown"}
                          </span>
                          <span>·</span>
                          <span>
                            {format(parseISO(n.createdAt), "MM/dd/yyyy h:mm a")}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
                          {n.note}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Add note form — only when timesheet is editable */}
            {canEdit && (
              <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note…"
                  rows={3}
                  autoFocus
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveNote}
                    disabled={noteSaving || !noteText.trim()}
                    className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40"
                  >
                    {noteSaving ? "Saving…" : "Add Note"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Entry Modal */}
      {showAddEntryModal && canEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { setShowAddEntryModal(false); setNewEntryError(null); }}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-700">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Add Time Entry</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {timecard?.employee.user?.name ?? timecard?.employee.employeeCode ?? employees.find((e) => e.employeeId === selectedEmployeeId)?.name ?? selectedEmployeeId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowAddEntryModal(false); setNewEntryError(null); }}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={newEntryMode === "hours" ? handleAddHoursEntry : handleAddEntry} className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-4">
                {/* Date — full width */}
                <div className="col-span-2 flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500">Date</label>
                  <input
                    type="date"
                    value={newEntryDate}
                    onChange={(e) => setNewEntryDate(e.target.value)}
                    required
                    min={format(parseUtcDate((timecard?.payPeriod ?? payPeriods.find((pp) => pp.id === selectedPeriodId))?.startDate ?? new Date().toISOString()), "yyyy-MM-dd")}
                    max={format(parseUtcDate((timecard?.payPeriod ?? payPeriods.find((pp) => pp.id === selectedPeriodId))?.endDate ?? new Date().toISOString()), "yyyy-MM-dd")}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>

                {/* Mode toggle */}
                <div className="col-span-2 flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => { setNewEntryMode("time"); setNewEntryError(null); }}
                    className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${newEntryMode === "time" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
                  >
                    In / Out Times
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNewEntryMode("hours"); setNewEntryError(null); }}
                    className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${newEntryMode === "hours" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
                  >
                    Reg Hours
                  </button>
                </div>

                {newEntryMode === "time" ? (
                  <>
                    {/* In Time */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-zinc-500">In Time</label>
                      <div className="flex min-w-0 gap-1.5">
                        <input
                          value={newInTimeStr}
                          onChange={(e) => setNewInTimeStr(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                          placeholder="8:00"
                          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        />
                        <select
                          value={newInAmPm}
                          onChange={(e) => setNewInAmPm(e.target.value as "AM" | "PM")}
                          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>
                    {/* Out Time */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-zinc-500">Out Time</label>
                      <div className="flex min-w-0 gap-1.5">
                        <input
                          value={newOutTimeStr}
                          onChange={(e) => setNewOutTimeStr(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                          placeholder="5:00"
                          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        />
                        <select
                          value={newOutAmPm}
                          onChange={(e) => setNewOutAmPm(e.target.value as "AM" | "PM")}
                          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  /* Reg Hours */
                  <div className="col-span-2 flex flex-col gap-1">
                    <label className="text-xs font-medium text-zinc-500">Reg Hours</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0.25"
                        max="24"
                        step="0.25"
                        value={newEntryHours}
                        onChange={(e) => setNewEntryHours(e.target.value)}
                        placeholder="8.00"
                        required
                        className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                      />
                      <span className="text-sm text-zinc-400">hours</span>
                    </div>
                  </div>
                )}

                {/* Pay Code */}
                {payCodes.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-zinc-500">Pay Code</label>
                    <select
                      value={newEntryPayCodeId}
                      onChange={(e) => setNewEntryPayCodeId(e.target.value)}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="">— Default —</option>
                      {payCodes.map((pc) => (
                        <option key={pc.id} value={pc.id}>{pc.code}[{pc.label}]</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Reason code dropdown */}
                {reasonCodes.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-zinc-500">Reason</label>
                    <select
                      value={newEntryReasonCodeId}
                      onChange={(e) => setNewEntryReasonCodeId(e.target.value)}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="">—</option>
                      {reasonCodes.map((rc) => (
                        <option key={rc.id} value={rc.id}>{rc.code} — {rc.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Notes — full width, saved as timesheet note */}
                <div className="col-span-2 flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500">Notes</label>
                  <input
                    value={newEntryNote}
                    onChange={(e) => setNewEntryNote(e.target.value)}
                    placeholder="Add a note for this entry…"
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              </div>
              {newEntryError && (
                <p className="text-xs text-red-500">{newEntryError}</p>
              )}
              <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => { setShowAddEntryModal(false); setNewEntryError(null); }}
                  className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || (newEntryMode === "time" ? (!newInTimeStr || !newOutTimeStr) : !newEntryHours)}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {isPending ? "Adding…" : "Add Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
