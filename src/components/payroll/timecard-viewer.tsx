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
  Badge,
  Banner,
  Button,
  Checkbox,
  EmptyState,
  FilterBar,
  FilterChip,
  Input,
  SearchInput,
  SegmentedControl,
  Select,
  TH,
  THead,
  TR,
  Textarea,
  Toolbar,
  statusTone,
  type BannerTone,
} from "@/components/ui";
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
  Users,
} from "lucide-react";

/**
 * The Timecards workspace, as the portal design lays it out.
 *
 * <p>Two of the design's templates meet on this screen. The employee picker is
 * the list template — a toolbar carrying the view segments, the search box and
 * the record count, then the filters that are actually applied as chips you can
 * clear one at a time. The sheet beside it is the timesheet grid: two header
 * rows, a vertical rule between the punches and the hours the engine calculated
 * from them, and the grouped summary underneath.
 *
 * <p>The two live inside one full-height pane rather than stacked down a
 * scrolling page because the job here is comparing a row of hours against the
 * punches that produced it, and a picker that scrolls away takes the next
 * employee with it.
 *
 * <p>Nothing in here calculates. Every figure on screen is read back from the
 * segments and buckets the rules engine wrote; the editable cells queue changes
 * and Save Changes sends them. That separation is why a restyle of this file
 * cannot move a payroll number.
 */

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
    ruleSet: { autoDeductMeal: boolean; mealBreakMinutes: number; mealBreakAfterMinutes: number; overtimeRequiresAuth: boolean; allowTimesheetOtAuth: boolean; defaultPayCodeId: string | null };
  };
  punches: TimecardPunch[];
  segments: TimecardSegment[];
  overtimeBuckets: TimecardBucket[];
  mealWaivers: { id: string; segmentDate: string; reason: string | null }[];
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

/**
 * A pay-code or reason-code dropdown inside the grid.
 *
 * <p>Amber while the pick is queued. This grid does not write on change — Save
 * Changes does — and a cell that looked identical before and after you chose a
 * code is how somebody walks away from a correction believing it landed.
 *
 * <p>Sized rather than full-width: four of these sit in a row with the punch
 * cells, and a select that filled its column would make the grid a wall of
 * boxes, which is the thing `.ta-cell` exists to avoid.
 */
function gridSelectStyle(pending: boolean, width: number): React.CSSProperties {
  return {
    width,
    height: 24,
    padding: "0 4px",
    boxSizing: "border-box",
    borderRadius: "var(--radius-s)",
    border: `1px solid ${pending ? "var(--stroke-warning)" : "var(--stroke-secondary)"}`,
    background: pending ? "var(--surface-warning)" : "var(--surface-card)",
    color: "var(--text-primary)",
    font: "var(--type-body2)",
    cursor: "pointer",
  };
}

/**
 * The bare button a grid cell is made of: no chrome until the cursor is on it,
 * so a fortnight of rows reads as a column of times rather than a keyboard.
 *
 * <p>The hover fill comes from `.ta-hoverable` rather than a `hover:bg-*`
 * utility. These cells carry their colour inline from tokens, and an inline
 * style beats a utility class — the utility would have rendered a grid where no
 * time ever lit up under the cursor, on the one screen where knowing a cell is
 * editable is the whole point.
 */
const gridCellButtonClass = "ta-hoverable rounded bg-transparent px-1 py-0.5";

/**
 * A punch time sitting in the grid.
 *
 * <p>Amber means an edit to it is queued and not yet written. That is the one
 * piece of state the grid must never lose: everything else on this screen is
 * read back from the database, and these are the cells that disagree with it.
 */
function punchCellStyle(pending: boolean, editable: boolean): React.CSSProperties {
  return {
    font: "var(--type-body1)",
    fontVariantNumeric: "tabular-nums",
    fontWeight: pending ? "var(--weight-medium)" : undefined,
    color: pending ? "var(--text-warning)" : "var(--text-primary)",
    border: 0,
    cursor: editable ? "pointer" : "default",
  };
}

/**
 * The three views the design gives this screen, expressed as the timesheet
 * statuses behind them.
 *
 * <p>"Ready to pay" is SUP_APPROVED, not PAYROLL_APPROVED: the phrase names the
 * queue this screen exists to clear. A supervisor has signed the hours off and
 * payroll has not, which is exactly the set the approve button on each row can
 * act on. Payroll-approved cards are already done, and a tab of finished work
 * is not a tab anybody opens twice.
 */
const VIEW_SEGMENTS: { value: string; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "SUP_APPROVED", label: "Ready to pay" },
];

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
    <div className="flex items-center gap-2">
      <Button
        hierarchy="secondary"
        size="sm"
        onClick={handleRecalculate}
        disabled={isPending}
        title="Recalculate segments and overtime"
        leadingIcon={
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
        }
      >
        {isPending ? "Recalculating…" : "Recalculate"}
      </Button>
      {error && (
        <span style={{ font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</span>
      )}
    </div>
  );
}

// Buckets that are paid at regular rate (shown in Reg Hrs column in summary)
const PAID_LEAVE_BUCKETS = new Set(["PTO", "SICK", "HOLIDAY", "FMLA", "BEREAVEMENT", "JURY_DUTY", "MILITARY"]);

// ─── Summary Row Helper ─────────────────────────────────────────────────────

/**
 * One line of the grouped summary under the grid.
 *
 * <p>Only two figures are ever coloured — overtime and double time, and only
 * when they are non-zero. Those are the two numbers that cost money nobody
 * planned to spend; colouring the rest would make the row a rainbow and the
 * premiums stop standing out. The totals line takes the design's footer fill
 * instead of a colour, so it reads as a summary of the column rather than
 * another record in it.
 */
function SummaryRow({
  label,
  reg,
  ot,
  dt,
  total,
  rate,
  isBold,
}: {
  label: string;
  reg: number;
  ot: number;
  dt: number;
  total: number;
  rate: number | null;
  isBold?: boolean;
}) {
  const fmt = (m: number) => minutesToHoursDecimal(m);
  const fmtMoney = (v: number) => `$${v.toFixed(2)}`;
  const regPay = rate ? (reg / 60) * rate : 0;
  const otPay = rate ? (ot / 60) * rate * 1.5 : 0;
  const dtPay = rate ? (dt / 60) * rate * 2 : 0;
  const totalPay = regPay + otPay + dtPay;

  const cell: React.CSSProperties = {
    padding: "0 12px",
    height: isBold ? 40 : 34,
    font: "var(--type-body1)",
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    color: isBold ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: isBold ? "var(--weight-semibold)" : undefined,
  };
  const emphasis = (on: boolean, color: string): React.CSSProperties =>
    on ? { ...cell, color, fontWeight: "var(--weight-semibold)" } : cell;
  const strong: React.CSSProperties = {
    ...cell,
    color: "var(--text-primary)",
    fontWeight: "var(--weight-semibold)",
  };

  return (
    <tr
      style={
        isBold
          ? {
              background: "var(--surface-tertiary)",
              borderTop: "1px solid var(--stroke-secondary)",
            }
          : { borderTop: "1px solid var(--stroke-divider)" }
      }
    >
      <td style={{ ...cell, textAlign: "left", fontVariantNumeric: "normal" }}>{label}</td>
      <td style={cell}>{reg > 0 ? fmt(reg) : "—"}</td>
      <td style={emphasis(ot > 0, "var(--text-warning)")}>{ot > 0 ? fmt(ot) : "—"}</td>
      <td style={emphasis(dt > 0, "var(--text-error)")}>{dt > 0 ? fmt(dt) : "—"}</td>
      <td style={isBold ? cell : strong}>{fmt(total)}</td>
      {rate !== null && (
        <>
          <td style={cell}>{fmtMoney(rate)}</td>
          <td style={cell}>{regPay > 0 ? fmtMoney(regPay) : "—"}</td>
          <td style={cell}>{otPay > 0 ? fmtMoney(otPay) : "—"}</td>
          <td style={cell}>{dtPay > 0 ? fmtMoney(dtPay) : "—"}</td>
          <td style={isBold ? cell : strong}>{fmtMoney(totalPay)}</td>
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
        {/* .ta-cell is the design's grid cell: quiet until you touch it, so a
            week of rows reads as times rather than as a wall of boxes. The
            explicit width overrides the class's 100%, which would otherwise
            stretch the field across the column. */}
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
          className="ta-cell"
          style={{ width: 70, minWidth: 0, height: 24, borderColor: "var(--stroke-accent)" }}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onAmPmToggle}
          style={{
            height: 24,
            padding: "0 6px",
            border: "1px solid var(--stroke-default)",
            borderRadius: "var(--radius-s)",
            background: "var(--surface-card)",
            color: "var(--text-primary)",
            font: "var(--type-button2)",
            cursor: "pointer",
          }}
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
            className="rounded p-0.5 disabled:opacity-40"
            style={{ color: "var(--icon-error)", background: "transparent", border: 0, cursor: "pointer" }}
            title="Remove punch"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {error && (
        <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{error}</span>
      )}
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

  function handlePayCodeChange(segmentId: string, payCodeId: string) {
    setPendingPayCodes((prev) => { const n = new Map(prev); n.set(segmentId, payCodeId); return n; });
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

  const pendingChangeCount =
    pendingPayCodes.size +
    pendingReasonCodes.size +
    pendingPunchEdits.size +
    pendingNewPunches.length +
    pendingWaiverToggles.size +
    pendingDeletions.length +
    pendingHoursEntries.length;
  const hasPendingChanges = pendingChangeCount > 0;

  function handleDiscardChanges() {
    setPendingPayCodes(new Map());
    setPendingReasonCodes(new Map());
    setPendingPunchEdits(new Map());
    setPendingNewPunches([]);
    setPendingWaiverToggles(new Set());
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

  // Column count for colSpan on expanded rows
  // Base: chevron + date + notes-icon + in + out + reg + ot + dt + total = 9
  // +1 if pay codes column exists, +1 if reason codes column exists, +1 if delete column shown
  const colCount = 9 + (payCodes.length > 0 ? 1 : 0) + (reasonCodes.length > 0 ? 1 : 0) + (timecard?.employee.ruleSet.autoDeductMeal ? 1 : 0) + (canDeleteManual ? 1 : 0);

  // The three column groups the grid's first header row spans: what the day is
  // (chevron, date, codes, notes), what was punched, and what was calculated —
  // then whatever trails after. Derived from the same optional columns as
  // colCount so the two can never drift apart.
  const leadColSpan = 3 + (payCodes.length > 0 ? 1 : 0) + (reasonCodes.length > 0 ? 1 : 0);
  const trailColSpan =
    (timecard?.employee.ruleSet.autoDeductMeal ? 1 : 0) + (canDeleteManual ? 1 : 0);

  const canApprove =
    timecard &&
    (timecard.status === "SUBMITTED" || timecard.status === "SUP_APPROVED");
  const canReject =
    timecard &&
    (timecard.status === "SUBMITTED" || timecard.status === "SUP_APPROVED");

  // Overtime the rules engine produced on a rule set that will not pay it until
  // somebody signs for it. Read twice below — once to say so, once to offer the
  // button — and the two must never disagree about whether there is any.
  const hasUnauthorizedOt = Boolean(
    timecard &&
      timecard.employee.ruleSet.overtimeRequiresAuth &&
      !timecard.otAuthorized &&
      timecard.overtimeBuckets.some(
        (b) => (b.bucket === "OT" || b.bucket === "DT") && b.totalMinutes > 0,
      ),
  );
  const canAuthorizeOt =
    hasUnauthorizedOt && !!timecard?.employee.ruleSet.allowTimesheetOtAuth;

  /**
   * The same URL {@link navigate} pushes, as an href.
   *
   * <p>The filter chips have to be links rather than click handlers: a payroll
   * list narrowed to one department is something people send each other, and a
   * chip that only mutated component state could not be middle-clicked, copied
   * or reloaded. Clearing the site clears the department with it, because the
   * departments offered are the ones at that site — exactly what the site
   * dropdown already does.
   */
  function filterHref(sid: string | null, did: string | null) {
    const params = new URLSearchParams();
    if (selectedEmployeeId) params.set("employeeId", selectedEmployeeId);
    if (selectedPeriodId) params.set("periodId", selectedPeriodId);
    if (sid) params.set("siteId", sid);
    if (did) params.set("departmentId", did);
    return `/payroll/timecards?${params.toString()}`;
  }

  const siteName = sites.find((s) => s.id === selectedSiteId)?.name ?? null;
  const departmentName =
    departments.find((d) => d.id === selectedDepartmentId)?.name ?? null;

  /**
   * The banner over the grid: where this timecard sits, and what is stopping it.
   *
   * <p>Only shown when there is something to say. An open, clean timecard gets
   * none — the status badge beside the name already carries that, and a banner
   * on every employee you click through would be a strip of colour people learn
   * to read past, which is exactly the banner you do not want them reading past
   * on the locked one.
   */
  const sheetNotice: { tone: BannerTone; title: string; body: string } | null = (() => {
    if (!timecard) return null;

    const blockers = [
      timecard.exceptionCount > 0 &&
        `${timecard.exceptionCount} exception${timecard.exceptionCount === 1 ? "" : "s"} on this timecard`,
      hasUnauthorizedOt && "overtime on it is not authorized",
    ].filter(Boolean) as string[];

    switch (timecard.status) {
      case "LOCKED":
        return {
          tone: "info",
          title: "Locked",
          body: "This pay period is closed. The hours are final and cannot be changed here.",
        };
      case "PAYROLL_APPROVED":
        return {
          tone: "success",
          title: "Payroll approved",
          body: "Approved for pay. Reopen the pay period to change anything on it.",
        };
      case "REJECTED":
        return {
          tone: "error",
          title: "Returned",
          body: "This timecard was sent back and is open for edits again.",
        };
      case "SUP_APPROVED":
        return {
          tone: blockers.length > 0 ? "warning" : "info",
          title: "Ready to pay",
          body:
            blockers.length > 0
              ? `A supervisor signed this off, but ${blockers.join(" and ")}.`
              : "A supervisor signed this off. It is waiting on payroll approval.",
        };
      case "SUBMITTED":
        return {
          tone: blockers.length > 0 ? "warning" : "info",
          title: "Submitted",
          body:
            blockers.length > 0
              ? `Waiting on a supervisor, and ${blockers.join(" and ")}.`
              : "Waiting on a supervisor to approve it.",
        };
      default:
        if (blockers.length > 0) {
          return {
            tone: "warning",
            title: "Needs attention",
            body: `This timecard is still open, and ${blockers.join(" and ")}.`,
          };
        }
        return readOnly
          ? {
              tone: "info",
              title: "Read only",
              body: "You can see these hours but your role cannot change them.",
            }
          : null;
    }
  })();

  return (
    <div
      className="ta-card flex h-[calc(100vh-7.25rem)] flex-col overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--stroke-secondary)" }}
    >
      {/* ── Period bar: which fortnight is on screen, and how to move ───
          Kept on its own row above the toolbar. The period is not a filter on
          the list — it is what every number under it means, and putting it
          beside the search box is how it gets read as one more way to narrow
          rows. */}
      <div
        className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2"
        style={{
          borderBottom: "1px solid var(--stroke-divider)",
          background: "var(--surface-tertiary)",
        }}
      >
        <Badge tone="info" size="sm">
          {PAY_FREQUENCY_LABEL[payFrequency as PayFrequencyValue] ?? payFrequency}
        </Badge>

        {/* Jump to current pay period */}
        <Button
          hierarchy="tertiary"
          size="sm"
          iconOnly
          onClick={() => currentPeriod && navigate(selectedEmployeeId, currentPeriod.id)}
          disabled={!currentPeriod || selectedPeriodId === currentPeriod.id}
          title="Jump to current pay period"
        >
          <CalendarCheck className="h-4 w-4" />
        </Button>

        {/* Previous / Next arrows with date display */}
        <div className="flex items-center gap-1">
          <Button
            hierarchy="tertiary"
            size="sm"
            iconOnly
            disabled={!hasPrev}
            onClick={() =>
              hasPrev && navigate(selectedEmployeeId, sortedPeriods[currentIndex - 1].id)
            }
            title="Previous pay period"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="tabular min-w-[220px] text-center"
            style={{
              font: "var(--type-body2)",
              fontWeight: "var(--weight-medium)",
              color: "var(--text-secondary)",
            }}
          >
            {(() => {
              const sel = sortedPeriods[currentIndex];
              if (!sel) return "—";
              const s = parseUtcDate(sel.startDate);
              const e = addDays(parseUtcDate(sel.endDate), -1);
              return `${format(s, "MM/dd/yyyy")} (${format(s, "EEE")}) – ${format(e, "MM/dd/yyyy")} (${format(e, "EEE")})`;
            })()}
          </span>
          <Button
            hierarchy="tertiary"
            size="sm"
            iconOnly
            disabled={!hasNext}
            onClick={() =>
              hasNext && navigate(selectedEmployeeId, sortedPeriods[currentIndex + 1].id)
            }
            title="Next pay period"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Month/year jump picker */}
        <div className="relative" ref={calendarRef}>
          <Button
            hierarchy="tertiary"
            size="sm"
            iconOnly
            onClick={() => {
              if (!showCalendar && selectedPp) {
                setPickerYear(parseUtcDate(selectedPp.startDate).getFullYear());
              }
              setShowCalendar((v) => !v);
            }}
            title="Jump to month"
          >
            <Calendar className="h-4 w-4" />
          </Button>
          {showCalendar && (
            <div className="ta-modal absolute left-0 top-full z-50 mt-1 w-52 rounded-lg p-3">
              {/* Year navigation */}
              <div className="mb-2.5 flex items-center justify-between">
                <Button hierarchy="tertiary" size="sm" iconOnly onClick={() => setPickerYear((y) => y - 1)} title="Previous year">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>
                  {pickerYear}
                </span>
                <Button hierarchy="tertiary" size="sm" iconOnly onClick={() => setPickerYear((y) => y + 1)} title="Next year">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {/* Month grid. A month with no pay period is disabled rather than
                  hidden — the gap is information, and a grid that reflowed
                  would move January under your cursor. */}
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
                      className={hasPeriod ? "ta-field" : undefined}
                      style={{
                        padding: "6px 0",
                        borderRadius: "var(--radius-s)",
                        border: "1px solid transparent",
                        font: "var(--type-button2)",
                        cursor: hasPeriod ? "pointer" : "default",
                        background: isSelected
                          ? "var(--fill-accent)"
                          : isCurrentMonth && hasPeriod
                            ? "var(--surface-info)"
                            : "transparent",
                        color: isSelected
                          ? "var(--text-on-accent)"
                          : !hasPeriod
                            ? "var(--text-disabled)"
                            : isCurrentMonth
                              ? "var(--text-accent)"
                              : "var(--text-primary)",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Site and department. Both are query parameters, so a list narrowed
            to one department survives a reload and can be sent to somebody —
            and the chips under this row are what take them off again. */}
        {sites.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="wms-overline">Site</span>
            <Select
              value={selectedSiteId ?? ""}
              onChange={(e) => navigate(null, selectedPeriodId, e.target.value || null, null)}
              aria-label="Site"
            >
              <option value="">All Sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </label>
        )}

        <label className="flex items-center gap-2">
          <span className="wms-overline">Dept</span>
          <Select
            value={selectedDepartmentId ?? ""}
            onChange={(e) =>
              navigate(selectedEmployeeId, selectedPeriodId, selectedSiteId, e.target.value || null)
            }
            aria-label="Department"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </label>
      </div>

      {/* ── Toolbar: which view, what you are searching, how many matched ──
          The count is the filtered one, not the tenant total. "No employees"
          and "no employees matching Submitted at this site" look identical
          without it, and the difference is whether somebody concludes a
          department has nothing left to approve. */}
      <div
        className="shrink-0 flex flex-col gap-2 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--stroke-divider)" }}
      >
        <Toolbar count={filteredEmployees.length} countLabel="employee">
          <SegmentedControl
            size="sm"
            ariaLabel="Timecard view"
            items={VIEW_SEGMENTS}
            // A status picked in the rail that no segment names — Open, Locked,
            // Payroll Approved — lights none of them, which is honest: you are
            // not looking at any of the three views.
            value={VIEW_SEGMENTS.some((v) => v.value === statusFilter) ? statusFilter : ""}
            onChange={setStatusFilter}
          />
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search employees…"
            width={240}
          />
        </Toolbar>

        {/* A chip appears whenever the parameter is set, even when the name
            behind it cannot be resolved — a site that has since been
            deactivated still filters the list, and a filter with no chip is a
            filter nobody can take off. */}
        <FilterBar clearHref={selectedSiteId || selectedDepartmentId ? filterHref(null, null) : undefined}>
          {selectedSiteId && (
            <FilterChip
              key="site"
              label="Site"
              value={siteName ?? "Filtered"}
              clearHref={filterHref(null, null)}
            />
          )}
          {selectedDepartmentId && (
            <FilterChip
              key="dept"
              label="Department"
              value={departmentName ?? "Filtered"}
              clearHref={filterHref(selectedSiteId, null)}
            />
          )}
        </FilterBar>
      </div>

      {/* ── Split pane ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-[264px_1fr] flex-1 min-h-0">
        {/* ── Left: employee list ─────────────────────────────────────── */}
        <div
          className="flex flex-col min-h-0"
          style={{ borderRight: "1px solid var(--stroke-secondary)" }}
        >
          {/* The refinements the three view segments do not cover. Status is
              here in full rather than only as the segments: four of its values
              — Open, Excluding Open, Payroll Approved, Locked — are how payroll
              finds the cards that are *not* ready, and dropping them to fit
              three tabs would have taken away the only way to ask "who has not
              submitted yet". Both controls write the same state. */}
          <div
            className="shrink-0 flex flex-col gap-2 p-2.5"
            style={{ borderBottom: "1px solid var(--stroke-divider)" }}
          >
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Timesheet status"
              style={{ width: "100%" }}
            >
              <option value="ALL">All Statuses</option>
              <option value="ALL_EXCLUDING_OPEN">Excluding Open</option>
              <option value="OPEN">Open</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="SUP_APPROVED">Supervisor Approved</option>
              <option value="PAYROLL_APPROVED">Payroll Approved</option>
              <option value="LOCKED">Locked</option>
            </Select>
            <Select
              value={payTypeFilter}
              onChange={(e) => setPayTypeFilter(e.target.value)}
              aria-label="Pay type"
              style={{ width: "100%" }}
            >
              <option value="ALL">All Pay Types</option>
              <option value="HOURLY">Hourly</option>
              <option value="SALARY">Salary</option>
            </Select>
            <Select
              value={exceptionFilter}
              onChange={(e) => setExceptionFilter(e.target.value)}
              aria-label="Exception type"
              style={{ width: "100%" }}
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
            </Select>
            <Checkbox checked={activeOnly} onChange={setActiveOnly} label="Active only" />
          </div>

          <div className="flex-1 overflow-y-auto" style={{ background: "var(--surface-card)" }}>
            {filteredEmployees.length === 0 && (
              // Says which of the two empty lists this is. "No employees" after
              // narrowing to Submitted reads as "this site is clean", and that
              // is how a pay period gets closed on somebody's unfinished card.
              <EmptyState
                icon={<Users className="h-7 w-7" />}
                title="No employees match"
                body={
                  search.trim()
                    ? `Nothing here matches “${search.trim()}”.`
                    : "Nobody is left once these filters are applied."
                }
              />
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
                    <div
                      className="sticky top-0 z-10 px-3 py-1.5"
                      style={{
                        background: "var(--surface-tertiary)",
                        borderBottom: "1px solid var(--stroke-secondary)",
                      }}
                    >
                      <span className="wms-overline">{group.siteName}</span>
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
                        aria-current={isSelected ? "true" : undefined}
                        // The selected row carries an accent rail as well as the
                        // tint: on a list scrolled past the fold, a tint alone
                        // is easy to lose against the hover state next to it.
                        className={`flex w-full cursor-pointer flex-col px-3 py-2.5 text-left transition-colors ${isSelected ? "" : "hover:bg-[var(--ta-row-hover)]"}`}
                        style={{
                          borderBottom: "1px solid var(--stroke-divider)",
                          borderLeft: `3px solid ${isSelected ? "var(--fill-accent)" : "transparent"}`,
                          paddingLeft: 9,
                          background: isSelected ? "var(--surface-info)" : undefined,
                        }}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <p
                            className="m-0 flex min-w-0 items-center gap-1.5 truncate"
                            style={{
                              font: "var(--type-body1)",
                              fontWeight: "var(--weight-medium)",
                              color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                            }}
                          >
                            {empExceptions.length > 0 && (
                              <span
                                title={`${empExceptions.length} exception${empExceptions.length !== 1 ? "s" : ""}`}
                                className="inline-block h-2 w-2 shrink-0 rounded-full"
                                style={{ background: "var(--fill-warning)" }}
                              />
                            )}
                            {emp.name}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {emp.totalMinutes !== undefined && (
                              <span
                                className="tabular"
                                style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                              >
                                {minutesToHoursDecimal(emp.totalMinutes)}h
                              </span>
                            )}
                            {canQuickApprove && (
                              <Button
                                hierarchy="primary"
                                tone="success"
                                size="sm"
                                iconOnly
                                onClick={(e) => { e.stopPropagation(); handleQuickApprove(emp as EmployeeListItem & { timesheetId: string; status: string }); }}
                                disabled={approvingId === emp.timesheetId}
                                title={empStatus === "SUP_APPROVED" ? "Payroll Approve" : "Approve"}
                                style={{ width: 20, height: 20 }}
                              >
                                {approvingId === emp.timesheetId ? "…" : <Check className="h-3 w-3" />}
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p
                            className="m-0 truncate"
                            style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                          >
                            {emp.employeeCode} · {emp.department}
                          </p>
                          {emp.status && (
                            <span className="shrink-0">
                              <Badge tone={statusTone(empStatus)} size="sm">
                                {TIMESHEET_STATUS_LABEL[empStatus as TimesheetStatusValue] ?? empStatus}
                              </Badge>
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
        <div className="flex flex-col min-h-0" style={{ background: "var(--surface-card)" }}>
          {!selectedEmployeeId || !days ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<Users className="h-8 w-8" />}
                title="No timecard open"
                body="Pick somebody from the list to see their punches and the hours calculated from them."
              />
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
              <div
                className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                style={{ borderBottom: "1px solid var(--stroke-divider)" }}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
                        {displayName}
                      </h2>
                      {selectedEmployeeId && (
                        <Button
                          hierarchy="tertiary"
                          size="sm"
                          iconOnly
                          onClick={() => router.push(`/admin/employees/${selectedEmployeeId}`)}
                          title="Go to employee profile"
                          style={{ width: 24, height: 24 }}
                        >
                          <UserCircle className="h-4 w-4" style={{ color: "var(--icon-secondary)" }} />
                        </Button>
                      )}
                    </div>
                    <p
                      className="m-0 flex items-center gap-1.5"
                      style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                    >
                      {displayCode} · {displayDept}
                      {/* Pay type is not a status, so it takes no tone. A salary
                          card and an hourly card are two kinds of record, not
                          two severities, and giving them colours competes with
                          the approval badge sitting next to them. */}
                      {displayPayType && (
                        <Badge size="sm">
                          {displayPayType === "SALARY" ? "Salary" : "Hourly"}
                        </Badge>
                      )}
                    </p>
                  </div>
                  {timecard ? (
                    <Badge tone={statusTone(timecard.status)} size="sm">
                      {TIMESHEET_STATUS_LABEL[
                        timecard.status as TimesheetStatusValue
                      ] ?? timecard.status}
                    </Badge>
                  ) : (
                    <Badge size="sm">No Punches</Badge>
                  )}
                  {/* Exceptions and unauthorised overtime are spelled out in the
                      banner below rather than as two more pills up here — this
                      row is already carrying the name, the code, the department,
                      the pay type and the status. */}
                </div>

                {/* Approval / Reject */}
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && (
                    <>
                      {timecard && <RecalculateButton timesheetId={timecard.timesheetId} />}
                      <Button
                        hierarchy="secondary"
                        size="sm"
                        leadingIcon={<Plus className="h-3.5 w-3.5" />}
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
                      >
                        Add Entry
                      </Button>
                    </>
                  )}
                  {canEdit && hasPendingChanges && (
                    <>
                      <Button
                        hierarchy="secondary"
                        size="sm"
                        onClick={handleDiscardChanges}
                        disabled={isPending}
                      >
                        Discard
                      </Button>
                      <Button size="sm" onClick={handleSaveChanges} disabled={isPending}>
                        {isPending ? "Saving…" : "Save Changes"}
                      </Button>
                    </>
                  )}
                  {actionError && (
                    <p
                      className="m-0"
                      style={{ font: "var(--type-body2)", color: "var(--text-error)" }}
                    >
                      {actionError}
                    </p>
                  )}
                  {showRejectForm ? (
                    <form onSubmit={handleReject} className="flex items-center gap-2">
                      <input
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Reason for rejection…"
                        required
                        autoFocus
                        className="ta-field w-48 rounded-md px-2.5"
                        style={{
                          height: 24,
                          border: "1px solid var(--stroke-default)",
                          background: "var(--surface-card)",
                          color: "var(--text-primary)",
                          font: "var(--type-body2)",
                          outline: "none",
                        }}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        tone="error"
                        disabled={isPending || !rejectNote.trim()}
                      >
                        {isPending ? "…" : "Confirm"}
                      </Button>
                      <Button
                        hierarchy="link"
                        size="sm"
                        onClick={() => {
                          setShowRejectForm(false);
                          setRejectNote("");
                        }}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <>
                      {canReject && (
                        <Button
                          hierarchy="secondary"
                          size="sm"
                          tone="error"
                          onClick={() => setShowRejectForm(true)}
                          disabled={isPending}
                        >
                          Reject
                        </Button>
                      )}
                      {canAuthorizeOt && (
                        <Button
                          size="sm"
                          tone="warning"
                          onClick={handleAuthorizeOt}
                          disabled={isPending}
                        >
                          {isPending ? "Saving…" : "Authorize OT"}
                        </Button>
                      )}
                      {canApprove && (
                        <Button
                          size="sm"
                          tone="success"
                          onClick={handleApprove}
                          disabled={isPending}
                        >
                          {isPending
                            ? "Saving…"
                            : timecard.status === "SUP_APPROVED"
                              ? "Payroll Approve"
                              : "Approve"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
                );
              })()}

              {/* The sheet's state, as the timesheet template opens with it.
                  Only rendered when there is something to say — see sheetNotice. */}
              {sheetNotice && (
                <div className="shrink-0 px-5 py-3">
                  <Banner
                    tone={sheetNotice.tone}
                    title={sheetNotice.title}
                    body={sheetNotice.body}
                  />
                </div>
              )}

              {/* What the grid will and will not do, said once. Edits here are
                  queued rather than written on blur, and a screen that looks
                  like a spreadsheet but is not one is how somebody navigates
                  away believing a correction was saved. */}
              <div
                className="shrink-0 flex flex-wrap items-center gap-3 px-5 py-2"
                style={{
                  borderBottom: "1px solid var(--stroke-divider)",
                  background: "var(--surface-secondary)",
                }}
              >
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  {canEdit
                    ? "Click a time, an hours figure or a code to change it. Nothing is written until you press Save Changes."
                    : "Read only — these hours cannot be changed from here."}
                </span>
                <div className="flex-1" />
                {hasPendingChanges && (
                  <Badge tone="warning" size="sm">
                    {pendingChangeCount} unsaved
                  </Badge>
                )}
              </div>

              {/* ── Scrollable timecard table + summary ──────────────── */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  {/* Two header rows, as the timesheet template draws them. The
                      vertical rules are what make "Punches" and "Calculated
                      Hours" read as two different kinds of number rather than
                      one wide row: the left group is what somebody recorded, the
                      right group is what the rules engine made of it, and only
                      one of the two is worth arguing with.

                      Row two sticks 24px down so both rows stay visible over a
                      fortnight of scrolling — a group label that scrolls away
                      takes the meaning of the columns with it. */}
                  <THead>
                    <TR>
                      <TH colSpan={leadColSpan} style={{ height: 24, borderBottom: 0, padding: "6px 12px 0" }} />
                      <TH
                        colSpan={2}
                        align="center"
                        style={{
                          height: 24,
                          borderBottom: 0,
                          padding: "6px 4px 0",
                          color: "var(--text-tertiary)",
                          borderLeft: "1px solid var(--stroke-secondary)",
                        }}
                      >
                        Punches
                      </TH>
                      <TH
                        colSpan={4}
                        align="center"
                        style={{
                          height: 24,
                          borderBottom: 0,
                          padding: "6px 12px 0",
                          color: "var(--text-tertiary)",
                          borderLeft: "1px solid var(--stroke-secondary)",
                        }}
                      >
                        Calculated Hours
                      </TH>
                      {trailColSpan > 0 && (
                        <TH colSpan={trailColSpan} style={{ height: 24, borderBottom: 0 }} />
                      )}
                    </TR>
                    <TR>
                      <TH style={{ width: 28, padding: "0 0 0 8px", top: 24 }} />
                      <TH style={{ top: 24 }}>Date</TH>
                      {payCodes.length > 0 && <TH style={{ paddingLeft: 8, paddingRight: 8, top: 24 }}>Code</TH>}
                      {reasonCodes.length > 0 && <TH style={{ paddingLeft: 8, paddingRight: 8, top: 24 }}>Reason</TH>}
                      <TH align="center" style={{ width: 28, paddingLeft: 4, paddingRight: 4, top: 24 }}>Notes</TH>
                      <TH style={{ top: 24, borderLeft: "1px solid var(--stroke-secondary)" }}>In</TH>
                      <TH style={{ top: 24 }}>Out</TH>
                      <TH numeric style={{ top: 24, borderLeft: "1px solid var(--stroke-secondary)" }}>Reg</TH>
                      <TH numeric style={{ top: 24 }}>OT</TH>
                      <TH numeric style={{ top: 24 }}>DT</TH>
                      <TH numeric style={{ paddingRight: 32, top: 24 }}>Total</TH>
                      {timecard?.employee.ruleSet.autoDeductMeal && <TH style={{ top: 24 }}>Meal</TH>}
                      {canDeleteManual && <TH style={{ width: 32, paddingLeft: 4, paddingRight: 4, top: 24 }} />}
                    </TR>
                  </THead>
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
                      // Compared in the same yyyy-MM-dd form dayKey is built in.
                      // The previous test put an ISO timestamp against a date
                      // string, so it never matched and a period starting on a
                      // Monday opened with a week rule above its first row.
                      const isFirstDay = format(days[0], "yyyy-MM-dd") === dayKey;
                      const showWeekSeparator = isMonday && !isFirstDay;

                      const buckets: Record<string, number> = {};
                      for (const seg of daySegments) {
                        // REG/OT/DT overrides are display-only tags; use engine payBucket for column math
                        const eb = (seg.payBucketOverride && !["REG", "OT", "DT"].includes(seg.payBucketOverride))
                          ? seg.payBucketOverride
                          : seg.payBucket;
                        // Holiday and leave credits display under the REG column
                        const displayBucket = (seg.segmentType === "HOLIDAY" || seg.segmentType === "LEAVE") ? "REG" : eb;
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
                              <td
                                colSpan={colCount}
                                className="h-0 p-0"
                                style={{ borderTop: "2px solid var(--stroke-default)" }}
                              />
                            </tr>
                          )}

                          {/* Day summary row.
                              One tint per row, and the order is severity: absent
                              beats an exception beats today beats the weekend.
                              A day with no hours on it is the one that costs
                              somebody money, so it outranks the rest. */}
                          <tr
                            className={`transition-colors ${isMainRowPendingDelete ? "opacity-40 line-through" : ""} ${
                              !isMainRowPendingDelete && !isAbsent && !hasException && !isTodayRow && !isWeekend
                                ? "hover:bg-[var(--ta-row-hover)]"
                                : ""
                            } ${hasActivity ? "cursor-pointer" : ""}`}
                            style={{
                              borderBottom: "1px solid var(--stroke-secondary)",
                              background: isMainRowPendingDelete
                                ? undefined
                                : isAbsent
                                  ? "var(--surface-error)"
                                  : hasException
                                    ? "var(--surface-warning)"
                                    : isTodayRow
                                      ? "var(--surface-info)"
                                      : isWeekend
                                        ? "var(--surface-tertiary)"
                                        : undefined,
                            }}
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
                                  className={`inline h-3.5 w-3.5 transition-transform ${
                                    isExpanded ? "rotate-90" : ""
                                  }`}
                                  style={{ color: "var(--icon-secondary)" }}
                                />
                              ) : isTodayRow ? (
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full"
                                  style={{ background: "var(--fill-accent)" }}
                                />
                              ) : null}
                            </td>

                            {/* Date (EEE MM/dd/yyyy) */}
                            <td
                              className="tabular px-3 py-1.5"
                              style={{
                                font: "var(--type-body1)",
                                fontWeight: "var(--weight-medium)",
                                color: isAbsent
                                  ? "var(--text-error)"
                                  : isTodayRow
                                    ? "var(--text-accent)"
                                    : isWeekend
                                      ? "var(--text-tertiary)"
                                      : "var(--text-secondary)",
                              }}
                            >
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
                                          className="ta-field"
                                          style={gridSelectStyle(absentPending, 96)}
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
                                      return <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{workSeg.payCode.code}[{workSeg.payCode.label}]</span>;
                                    }
                                    return <span style={{ font: "var(--type-body2)", color: "var(--text-error)" }}>Absent</span>;
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
                                          className="ta-field"
                                          style={gridSelectStyle(absentPending, 96)}
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
                                      ? <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{dayMarker.payCode.code}[{dayMarker.payCode.label}]</span>
                                      : null;
                                  }

                                  // Holiday day: show the HOLIDAY segment's pay code read-only.
                                  // The credit is engine-managed; admin cannot change it here.
                                  if (!workSeg) {
                                    const holidaySeg = daySegments.find((s) => s.segmentType === "HOLIDAY" && s.durationMinutes > 0);
                                    if (holidaySeg?.payCode) {
                                      return <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{holidaySeg.payCode.code}[{holidaySeg.payCode.label}]</span>;
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
                                          className="ta-field"
                                          style={gridSelectStyle(absentPending, 96)}
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
                                      onChange={(e) => handlePayCodeChange(workSeg.id, e.target.value)}
                                      className="ta-field"
                                      style={gridSelectStyle(workSegPending, 96)}
                                    >
                                      <option value="">—</option>
                                      {payCodes.map((pc) => (
                                        <option key={pc.id} value={pc.id}>
                                          {pc.code}[{pc.label}]
                                        </option>
                                      ))}
                                    </select>
                                  ) : workSeg.payCode ? (
                                    <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
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
                                        className="ta-field"
                                        style={gridSelectStyle(reasonPending, 112)}
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
                                    <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{dayReason.reasonCode.code}[{dayReason.reasonCode.label}]</span>
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
                                    className="relative rounded bg-transparent p-0.5 ta-hoverable"
                                    style={{
                                      border: 0,
                                      cursor: "pointer",
                                      color: dayNoteCount > 0 ? "var(--icon-warning)" : "var(--icon-secondary)",
                                    }}
                                  >
                                    <StickyNote className="h-4 w-4" />
                                    {dayNoteCount > 1 && (
                                      <span
                                        className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full"
                                        style={{
                                          background: "var(--fill-warning)",
                                          color: "var(--text-on-accent)",
                                          font: "var(--weight-bold) 9px/1 var(--font-sans)",
                                        }}
                                      >
                                        {dayNoteCount}
                                      </span>
                                    )}
                                  </button>
                                );
                              })()}
                            </td>

                            {/* In time */}
                            <td
                              className="px-2 py-1"
                              style={{
                                font: "var(--type-body1)",
                                fontVariantNumeric: "tabular-nums",
                                color: isAbsent ? "var(--text-error)" : "var(--text-secondary)",
                                borderLeft: "1px solid var(--stroke-secondary)",
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
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
                                  className={canEdit ? gridCellButtonClass : "bg-transparent"} style={punchCellStyle(pendingPunchEdits.has(firstIn.id), canEdit)}
                                >
                                  {pendingPunchEdits.has(firstIn.id) ? format(pendingPunchEdits.get(firstIn.id)!, "h:mm a") : format(parseISO(firstIn.roundedTime), "h:mm a")}
                                </button>
                              ) : (() => {
                                const pendingNewIn = pendingNewPunches.find((p) => p.dayKey === dayKey && p.pairIndex === 0 && p.punchType === "CLOCK_IN");
                                if (pendingNewIn) return (
                                  <div className="flex items-center gap-0.5">
                                    <span className="tabular" style={{ font: "var(--type-body2)", fontWeight: "var(--weight-medium)", color: "var(--text-warning)" }}>{format(pendingNewIn.punchDate, "h:mm a")}</span>
                                    <button type="button" onClick={() => setPendingNewPunches((prev) => prev.filter((p) => !(p.dayKey === dayKey && p.pairIndex === 0 && p.punchType === "CLOCK_IN")))} className="rounded bg-transparent p-0.5 ta-hoverable" style={{ border: 0, cursor: "pointer", color: "var(--icon-error)" }} title="Remove pending"><X className="h-2.5 w-2.5" /></button>
                                  </div>
                                );
                                return hasMissingPunch && canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startAddingPunch(dayKey, 0, "CLOCK_IN", day, lastOut ? parseISO(lastOut.roundedTime) : null)}
                                    className={gridCellButtonClass}
                                    style={{ ...punchCellStyle(true, true), fontWeight: "var(--weight-medium)" }}
                                  >
                                    Missed
                                  </button>
                                ) : hasMissingPunch ? (
                                  <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-warning)" }}>Missed</span>
                                ) : canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startAddingPunch(dayKey, 0, "CLOCK_IN", day)}
                                    className={gridCellButtonClass}
                                    style={{ ...punchCellStyle(false, true), color: "var(--text-disabled)" }}
                                  >
                                    —
                                  </button>
                                ) : (
                                  <span style={{ color: "var(--text-disabled)" }}>—</span>
                                );
                              })()}
                            </td>

                            {/* Out time */}
                            <td
                              className="px-2 py-1"
                              style={{ font: "var(--type-body1)", fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}
                              onClick={(e) => e.stopPropagation()}
                            >
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
                                  className={canEdit ? gridCellButtonClass : "bg-transparent"} style={punchCellStyle(pendingPunchEdits.has(lastOut.id), canEdit)}
                                >
                                  {pendingPunchEdits.has(lastOut.id) ? format(pendingPunchEdits.get(lastOut.id)!, "h:mm a") : format(parseISO(lastOut.roundedTime), "h:mm a")}
                                </button>
                              ) : (() => {
                                const pendingNewOut = pendingNewPunches.find((p) => p.dayKey === dayKey && p.pairIndex === 0 && p.punchType === "CLOCK_OUT");
                                if (pendingNewOut) return (
                                  <div className="flex items-center gap-0.5">
                                    <span className="tabular" style={{ font: "var(--type-body2)", fontWeight: "var(--weight-medium)", color: "var(--text-warning)" }}>{format(pendingNewOut.punchDate, "h:mm a")}</span>
                                    <button type="button" onClick={() => setPendingNewPunches((prev) => prev.filter((p) => !(p.dayKey === dayKey && p.pairIndex === 0 && p.punchType === "CLOCK_OUT")))} className="rounded bg-transparent p-0.5 ta-hoverable" style={{ border: 0, cursor: "pointer", color: "var(--icon-error)" }} title="Remove pending"><X className="h-2.5 w-2.5" /></button>
                                  </div>
                                );
                                return hasMissingPunch && canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startAddingPunch(dayKey, 0, "CLOCK_OUT", day, firstIn ? parseISO(firstIn.roundedTime) : null)}
                                    className={gridCellButtonClass}
                                    style={{ ...punchCellStyle(true, true), fontWeight: "var(--weight-medium)" }}
                                  >
                                    Missed
                                  </button>
                                ) : hasMissingPunch ? (
                                  <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-warning)" }}>Missed</span>
                                ) : canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startAddingPunch(dayKey, 0, "CLOCK_OUT", day)}
                                    className={gridCellButtonClass}
                                    style={{ ...punchCellStyle(false, true), color: "var(--text-disabled)" }}
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
                                  className="tabular px-3 py-1.5 text-right"
                                  style={{
                                    font: "var(--type-body1)",
                                    borderLeft: "1px solid var(--stroke-secondary)",
                                    color: isAbsent
                                      ? "var(--text-error)"
                                      : hasMissingPunch
                                        ? "var(--text-warning)"
                                        : reg > 0 || isSalaryVirtualDay
                                          ? "var(--text-secondary)"
                                          : "var(--text-disabled)",
                                  }}
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
                                          className="ta-cell"
                                          style={{ width: 56, minWidth: 0, height: 24, textAlign: "right", borderColor: "var(--stroke-accent)" }}
                                        />
                                        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>h</span>
                                      </div>
                                      {hoursError && (
                                        <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{hoursError}</span>
                                      )}
                                    </div>
                                  ) : pendingHours !== undefined ? (
                                    <span style={{ fontWeight: "var(--weight-medium)", color: "var(--text-warning)" }}>{pendingHours.toFixed(2)}</span>
                                  ) : canAddHours ? (
                                    <button
                                      type="button"
                                      title="Add manual hours"
                                      onClick={() => { setEditingHours({ dayKey, value: "" }); setHoursError(null); }}
                                      className={gridCellButtonClass}
                                      style={{ ...punchCellStyle(false, true), color: "inherit" }}
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
                            <td
                              className="tabular px-3 py-1.5 text-right"
                              style={{
                                font: "var(--type-body1)",
                                fontWeight: ot > 0 && !isAbsent && !hasMissingPunch ? "var(--weight-semibold)" : undefined,
                                color: isAbsent
                                  ? "var(--text-error)"
                                  : hasMissingPunch
                                    ? "var(--text-warning)"
                                    : ot > 0
                                      ? "var(--text-warning)"
                                      : "var(--text-disabled)",
                              }}
                            >
                              {hasMissingPunch ? "—" : ot > 0 ? minutesToHoursDecimal(ot) : "—"}
                            </td>

                            {/* DT */}
                            <td
                              className="tabular px-3 py-1.5 text-right"
                              style={{
                                font: "var(--type-body1)",
                                fontWeight: dt > 0 && !isAbsent && !hasMissingPunch ? "var(--weight-semibold)" : undefined,
                                color: isAbsent
                                  ? "var(--text-error)"
                                  : hasMissingPunch
                                    ? "var(--text-warning)"
                                    : dt > 0
                                      ? "var(--text-error)"
                                      : "var(--text-disabled)",
                              }}
                            >
                              {hasMissingPunch ? "—" : dt > 0 ? minutesToHoursDecimal(dt) : "—"}
                            </td>

                            {/* Total */}
                            <td
                              className="tabular py-1.5 pl-3 pr-8 text-right"
                              style={{
                                font: "var(--type-body1)",
                                fontWeight:
                                  isAbsent || hasMissingPunch || dailyTotal > 0 || isSalaryVirtualDay
                                    ? "var(--weight-bold)"
                                    : undefined,
                                color: isAbsent
                                  ? "var(--text-error)"
                                  : hasMissingPunch
                                    ? "var(--text-warning)"
                                    : dailyTotal > 0 || isSalaryVirtualDay
                                      ? "var(--text-primary)"
                                      : "var(--text-disabled)",
                              }}
                            >
                              {isAbsent ? "0.00" : hasMissingPunch ? "—" : (dailyTotal > 0 || isSalaryVirtualDay) ? minutesToHoursDecimal(dailyTotal || SALARY_VIRTUAL_MINS) : "—"}
                            </td>

                            {/* Meal waiver cell */}
                            {timecard?.employee.ruleSet.autoDeductMeal && (() => {
                              const rawWorkMins = daySegments.filter((s) => s.segmentType === "WORK").reduce((a, s) => a + s.durationMinutes, 0);
                              const mealSeg = daySegments.find((s) => s.segmentType === "MEAL");
                              const totalWorkForThreshold = rawWorkMins + (mealSeg?.durationMinutes ?? 0);
                              const dbWaiver = timecard?.mealWaivers.find((w) => w.segmentDate === dayStr);
                              const waiverToggled = pendingWaiverToggles.has(dayStr);
                              const effectiveHasWaiver = waiverToggled ? !dbWaiver : !!dbWaiver;
                              return (
                                <td className="px-3 py-1 text-left" onClick={(e) => e.stopPropagation()}>
                                  {totalWorkForThreshold <= (timecard?.employee.ruleSet.mealBreakAfterMinutes ?? 0) ? (
                                    <span style={{ font: "var(--type-body2)", color: "var(--text-disabled)" }}>—</span>
                                  ) : effectiveHasWaiver ? (
                                    <div className="flex items-center gap-1.5">
                                      {canEdit ? (
                                        <button
                                          type="button"
                                          onClick={() => handleToggleWaiver(dayStr)}
                                          title="Click to remove waiver"
                                          className="inline-flex items-center rounded-full px-2 py-0.5 transition-colors"
                                          style={{
                                            font: "var(--type-body2)",
                                            fontWeight: "var(--weight-medium)",
                                            background: "var(--surface-warning)",
                                            color: "var(--text-warning)",
                                            border: `1px solid ${waiverToggled ? "var(--stroke-warning)" : "transparent"}`,
                                            cursor: "pointer",
                                          }}
                                        >
                                          {waiverToggled ? "Waived*" : "Waived"}
                                        </button>
                                      ) : (
                                        <Badge tone="warning" size="sm">Waived</Badge>
                                      )}
                                      {waiverError && (
                                        <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{waiverError}</span>
                                      )}
                                    </div>
                                  ) : canEdit ? (
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleWaiver(dayStr)}
                                        className="rounded-full px-2 py-0.5 transition-colors"
                                        style={{
                                          font: "var(--type-body2)",
                                          background: waiverToggled ? "var(--surface-warning)" : "var(--fill-hover)",
                                          color: waiverToggled ? "var(--text-warning)" : "var(--text-secondary)",
                                          border: `1px solid ${waiverToggled ? "var(--stroke-warning)" : "transparent"}`,
                                          cursor: "pointer",
                                        }}
                                      >
                                        {waiverToggled ? "Waive*" : "Waive"}
                                      </button>
                                      {waiverError && (
                                        <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{waiverError}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ font: "var(--type-body2)", color: "var(--text-disabled)" }}>—</span>
                                  )}
                                </td>
                              );
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
                                      className="rounded bg-transparent p-0.5 ta-hoverable disabled:opacity-50"
                                      style={{
                                        border: 0,
                                        cursor: "pointer",
                                        color: isPendingDelete ? "var(--icon-error)" : "var(--icon-disabled)",
                                      }}
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
                              const inMs = pairIn ? new Date(pairIn.roundedTime).getTime() : 0;
                              const outMs = pairOut ? new Date(pairOut.roundedTime).getTime() : Infinity;
                              return sStart >= inMs && sStart < outMs;
                            }) ?? null;
                            return (
                              <tr
                                key={`${dayKey}-pair${pairIdx}`}
                                style={{ borderBottom: "1px solid var(--stroke-secondary)" }}
                              >
                                {/* Empty chevron */}
                                <td className="w-7 pl-2 pr-0" />
                                {/* Continuation date indicator */}
                                <td className="px-3 py-1">
                                  <span className="ml-4" style={{ color: "var(--text-disabled)" }}>↳</span>
                                </td>
                                {/* Pay code DB cell */}
                                {payCodes.length > 0 && (
                                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                    {pairWorkSeg && canEdit ? (
                                      <select
                                        value={pendingPayCodes.has(pairWorkSeg.id) ? (pendingPayCodes.get(pairWorkSeg.id) ?? "") : (pairWorkSeg.payCode?.id ?? "")}
                                        onChange={(e) => handlePayCodeChange(pairWorkSeg.id, e.target.value)}
                                        className="ta-field"
                                        style={gridSelectStyle(pendingPayCodes.has(pairWorkSeg.id), 96)}
                                      >
                                        <option value="">—</option>
                                        {payCodes.map((pc) => (
                                          <option key={pc.id} value={pc.id}>
                                            {pc.code}[{pc.label}]
                                          </option>
                                        ))}
                                      </select>
                                    ) : pairWorkSeg?.payCode ? (
                                      <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
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
                                          className="ta-field"
                                          style={gridSelectStyle(absentPending, 96)}
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
                                        className="relative rounded bg-transparent p-0.5 ta-hoverable"
                                        style={{
                                          border: 0,
                                          cursor: "pointer",
                                          color: contNoteCount > 0 ? "var(--icon-warning)" : "var(--icon-secondary)",
                                        }}
                                      >
                                        <StickyNote className="h-4 w-4" />
                                      </button>
                                    );
                                  })()}
                                </td>
                                {/* In cell */}
                                <td
                                  className="px-2 py-1"
                                  style={{
                                    font: "var(--type-body1)",
                                    fontVariantNumeric: "tabular-nums",
                                    color: "var(--text-secondary)",
                                    borderLeft: "1px solid var(--stroke-secondary)",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
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
                                    <button type="button" onClick={() => startEditing(pairIn)} disabled={!canEdit} className={canEdit ? gridCellButtonClass : "bg-transparent"} style={punchCellStyle(pendingPunchEdits.has(pairIn.id), canEdit)}>{pendingPunchEdits.has(pairIn.id) ? format(pendingPunchEdits.get(pairIn.id)!, "h:mm a") : format(parseISO(pairIn.roundedTime), "h:mm a")}</button>
                                  ) : (() => {
                                    const pendingNewPairIn = pendingNewPunches.find((p) => p.dayKey === dayKey && p.pairIndex === pairIdx && p.punchType === "CLOCK_IN");
                                    if (pendingNewPairIn) return (
                                      <div className="flex items-center gap-0.5">
                                        <span className="tabular" style={{ font: "var(--type-body2)", fontWeight: "var(--weight-medium)", color: "var(--text-warning)" }}>{format(pendingNewPairIn.punchDate, "h:mm a")}</span>
                                        <button type="button" onClick={() => setPendingNewPunches((prev) => prev.filter((p) => !(p.dayKey === dayKey && p.pairIndex === pairIdx && p.punchType === "CLOCK_IN")))} className="rounded bg-transparent p-0.5 ta-hoverable" style={{ border: 0, cursor: "pointer", color: "var(--icon-error)" }} title="Remove pending"><X className="h-2.5 w-2.5" /></button>
                                      </div>
                                    );
                                    return canEdit ? (
                                      <button type="button" onClick={() => startAddingPunch(dayKey, pairIdx, "CLOCK_IN", day)} className={gridCellButtonClass}
                                    style={{ ...punchCellStyle(false, true), color: "var(--text-disabled)" }}>—</button>
                                    ) : (
                                      <span style={{ color: "var(--text-disabled)" }}>—</span>
                                    );
                                  })()}
                                </td>
                                {/* Out cell */}
                                <td
                                  className="px-2 py-1"
                                  style={{ font: "var(--type-body1)", fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
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
                                    <button type="button" onClick={() => startEditing(pairOut)} disabled={!canEdit} className={canEdit ? gridCellButtonClass : "bg-transparent"} style={punchCellStyle(pendingPunchEdits.has(pairOut.id), canEdit)}>{pendingPunchEdits.has(pairOut.id) ? format(pendingPunchEdits.get(pairOut.id)!, "h:mm a") : format(parseISO(pairOut.roundedTime), "h:mm a")}</button>
                                  ) : (() => {
                                    const pendingNewPairOut = pendingNewPunches.find((p) => p.dayKey === dayKey && p.pairIndex === pairIdx && p.punchType === "CLOCK_OUT");
                                    if (pendingNewPairOut) return (
                                      <div className="flex items-center gap-0.5">
                                        <span className="tabular" style={{ font: "var(--type-body2)", fontWeight: "var(--weight-medium)", color: "var(--text-warning)" }}>{format(pendingNewPairOut.punchDate, "h:mm a")}</span>
                                        <button type="button" onClick={() => setPendingNewPunches((prev) => prev.filter((p) => !(p.dayKey === dayKey && p.pairIndex === pairIdx && p.punchType === "CLOCK_OUT")))} className="rounded bg-transparent p-0.5 ta-hoverable" style={{ border: 0, cursor: "pointer", color: "var(--icon-error)" }} title="Remove pending"><X className="h-2.5 w-2.5" /></button>
                                      </div>
                                    );
                                    return canEdit ? (
                                      <button type="button" onClick={() => startAddingPunch(dayKey, pairIdx, "CLOCK_OUT", day)} className={gridCellButtonClass}
                                    style={{ ...punchCellStyle(false, true), color: "var(--text-disabled)" }}>—</button>
                                    ) : null;
                                  })()}
                                </td>
                                {/* Hours: blank for continuation rows. The engine attributes a day's
                                    hours to the day, not to each punch pair, so splitting
                                    them across these rows would invent a number. */}
                                <td
                                  className="px-3 py-1.5 text-right"
                                  style={{ font: "var(--type-body1)", color: "var(--text-disabled)", borderLeft: "1px solid var(--stroke-secondary)" }}
                                >
                                  —
                                </td>
                                <td className="px-3 py-1.5 text-right" style={{ font: "var(--type-body1)", color: "var(--text-disabled)" }}>—</td>
                                <td className="px-3 py-1.5 text-right" style={{ font: "var(--type-body1)", color: "var(--text-disabled)" }}>—</td>
                                <td className="py-1.5 pl-3 pr-8 text-right" style={{ font: "var(--type-body1)", color: "var(--text-disabled)" }}>—</td>
                                {timecard?.employee.ruleSet.autoDeductMeal && <td />}
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
                                          className="rounded bg-transparent p-0.5 ta-hoverable disabled:opacity-50"
                                      style={{
                                        border: 0,
                                        cursor: "pointer",
                                        color: isPendingDelete ? "var(--icon-error)" : "var(--icon-disabled)",
                                      }}
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
                            <tr
                              key={`${dayKey}-leave-${seg.id}`}
                              style={{
                                borderBottom: "1px solid var(--stroke-divider)",
                                background: "var(--surface-secondary)",
                              }}
                            >
                              <td className="w-7 pl-2 pr-0 py-1.5" />
                              <td className="px-3 py-1 text-left">
                                <Badge tone="purple" size="sm" style={{ paddingRight: canEdit && seg.leaveRequest?.id ? 4 : undefined }}>
                                  {seg.leaveRequest?.leaveType.name ?? PAY_BUCKET_LABEL[seg.payBucket as PayBucketValue] ?? seg.payBucket}
                                  {canEdit && seg.leaveRequest?.id && (
                                    <button
                                      type="button"
                                      disabled={isPending}
                                      onClick={() => handleRemoveLeave(seg.leaveRequest!.id)}
                                      className="rounded-full p-0.5 disabled:opacity-50"
                                      style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer", lineHeight: 0 }}
                                      title="Remove leave entry"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  )}
                                </Badge>
                              </td>
                              {payCodes.length > 0 && (() => {
                                const leavePayCode = seg.payCode ?? seg.leaveRequest?.leaveType.payCode ?? null;
                                return (
                                  <td className="px-2 py-1">
                                    {leavePayCode ? (
                                      <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                                        {leavePayCode.code}[{leavePayCode.label}]
                                      </span>
                                    ) : (
                                      <span style={{ font: "var(--type-body2)", color: "var(--text-disabled)" }}>—</span>
                                    )}
                                  </td>
                                );
                              })()}
                              {reasonCodes.length > 0 && <td className="px-2 py-1.5" />}
                              <td className="w-7 px-1 py-1.5" />
                              <td
                                className="px-2 py-1"
                                style={{ font: "var(--type-body1)", color: "var(--text-disabled)", borderLeft: "1px solid var(--stroke-secondary)" }}
                              >
                                —
                              </td>
                              <td className="px-2 py-1" style={{ font: "var(--type-body1)", color: "var(--text-disabled)" }}>—</td>
                              <td
                                className="tabular px-3 py-1.5 text-right"
                                style={{
                                  font: "var(--type-body1)",
                                  fontWeight: "var(--weight-medium)",
                                  color: "var(--text-primary)",
                                  borderLeft: "1px solid var(--stroke-secondary)",
                                }}
                              >
                                {minutesToHoursDecimal(seg.durationMinutes)}
                              </td>
                              <td className="px-3 py-1.5 text-right" style={{ font: "var(--type-body1)", color: "var(--text-disabled)" }}>—</td>
                              <td className="px-3 py-1.5 text-right" style={{ font: "var(--type-body1)", color: "var(--text-disabled)" }}>—</td>
                              <td
                                className="tabular py-1.5 pl-3 pr-8 text-right"
                                style={{ font: "var(--type-body1)", fontWeight: "var(--weight-bold)", color: "var(--text-primary)" }}
                              >
                                {minutesToHoursDecimal(seg.durationMinutes)}
                              </td>
                              {timecard?.employee.ruleSet.autoDeductMeal && <td />}
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
                              style={{
                                borderBottom: "1px solid var(--stroke-secondary)",
                                background: "var(--surface-secondary)",
                              }}
                            >
                              <td colSpan={colCount} className="px-5 py-2">
                                <div className="flex flex-wrap items-start gap-2">
                                  {dayPunches
                                    .filter((p) => !pairs.some((pr) => pr.inPunch?.id === p.id || pr.outPunch?.id === p.id))
                                    .map((punch) =>
                                      editingPunchId === punch.id ? (
                                        <div
                                          key={punch.id}
                                          className="flex w-full items-center gap-2 rounded-lg p-2"
                                          style={{
                                            border: "1px solid var(--stroke-accent-focus)",
                                            background: "var(--surface-info)",
                                          }}
                                        >
                                          <span
                                            className="shrink-0"
                                            style={{
                                              font: "var(--type-body2)",
                                              fontWeight: "var(--weight-medium)",
                                              color: "var(--text-accent)",
                                            }}
                                          >
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
                                          className="inline-flex items-center gap-1 rounded px-2 py-1 transition-colors"
                                          style={{
                                            font: "var(--type-body2)",
                                            border: 0,
                                            cursor: canEdit ? "pointer" : "default",
                                            background: pendingPunchEdits.has(punch.id)
                                              ? "var(--surface-warning)"
                                              : "var(--fill-hover)",
                                            color: pendingPunchEdits.has(punch.id)
                                              ? "var(--text-warning)"
                                              : canEdit
                                                ? "var(--text-primary)"
                                                : "var(--text-secondary)",
                                          }}
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
                <div
                  className="flex flex-wrap items-center gap-4 px-4 py-2"
                  style={{
                    borderTop: "1px solid var(--stroke-secondary)",
                    background: "var(--surface-tertiary)",
                  }}
                >
                  <span className="wms-overline">Legend</span>
                  {[
                    { label: "Absent", fill: "var(--surface-error)", line: "var(--stroke-error)" },
                    { label: "Exception", fill: "var(--surface-warning)", line: "var(--stroke-warning)" },
                    { label: "Today", fill: "var(--surface-info)", line: "var(--stroke-accent-focus)" },
                    { label: "Weekend", fill: "var(--surface-tertiary)", line: "var(--stroke-default)" },
                  ].map((l) => (
                    <span
                      key={l.label}
                      className="flex items-center gap-1.5"
                      style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                    >
                      <span
                        className="inline-block h-3 w-3 rounded"
                        style={{ background: l.fill, border: `1px solid ${l.line}` }}
                      />
                      {l.label}
                    </span>
                  ))}
                </div>

                {/* ── Summary with Group By ──────────────────────────── */}
                <div style={{ borderTop: "1px solid var(--stroke-secondary)" }}>
                  {/* The summary card's header, as the timesheet template draws
                      it: title and sub on the left, "Group by" on the right.
                      Segments rather than a dropdown because there are three of
                      them and the choice is a view, not a setting. Pay Code only
                      appears when this tenant has codes to group by. */}
                  <div
                    className="flex flex-wrap items-center gap-3 px-4 py-2"
                    style={{ background: "var(--surface-tertiary)" }}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>
                        Timesheet Summary
                      </span>
                      <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                        {summaryGroupBy === "week"
                          ? "Each week in this pay period"
                          : summaryGroupBy === "paycode"
                            ? "Hours by the code they will be paid under"
                            : "Everything in this pay period"}
                      </span>
                    </div>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                      <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                        Group by
                      </span>
                      <SegmentedControl
                        size="sm"
                        ariaLabel="Group the summary by"
                        value={summaryGroupBy}
                        onChange={(next) =>
                          setSummaryGroupBy(next as "total" | "week" | "paycode")
                        }
                        items={[
                          { value: "total", label: "Total" },
                          { value: "week", label: "Week" },
                          ...(payCodes.length > 0
                            ? [{ value: "paycode", label: "Pay Code" }]
                            : []),
                        ]}
                      />
                    </div>
                  </div>

                  {/* Summary table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <THead>
                        <TR>
                          <TH>
                            {summaryGroupBy === "week"
                              ? "Week"
                              : summaryGroupBy === "paycode"
                                ? "Pay Code"
                                : "Category"}
                          </TH>
                          <TH numeric>Reg Hrs</TH>
                          <TH numeric>OT</TH>
                          <TH numeric>DT</TH>
                          <TH numeric>Total Hrs</TH>
                          {rate !== null && (
                            <>
                              <TH numeric>Rate</TH>
                              <TH numeric>Reg Pay</TH>
                              <TH numeric>OT Pay</TH>
                              <TH numeric>DT Pay</TH>
                              <TH numeric>Total Pay</TH>
                            </>
                          )}
                        </TR>
                      </THead>
                      <tbody>
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
            className="flex w-full max-w-lg flex-col rounded-xl ta-modal"
            style={{ maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex shrink-0 items-center justify-between gap-3 px-5 py-3.5"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex flex-col gap-0.5">
                <h3 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
                  Notes
                </h3>
                <p
                  className="m-0"
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                >
                  {(() => {
                    try { return format(parseISO(noteDay), "EEE MM/dd/yyyy"); } catch { return noteDay; }
                  })()}
                  {" · "}{timecard.employee.user?.name ?? timecard.employee.employeeCode}
                </p>
              </div>
              <Button
                hierarchy="tertiary"
                size="sm"
                iconOnly
                onClick={() => { setNoteDay(null); setNoteText(""); }}
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Notes list */}
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const dayNotes = (timecard?.notes ?? []).filter((n) => n.noteDate === noteDay);
                if (dayNotes.length === 0) {
                  return (
                    <EmptyState
                      icon={<StickyNote className="h-7 w-7" />}
                      title="No notes on this day"
                      body="Anything saved here is kept with the timecard, so the next person can see why an entry looks the way it does."
                    />
                  );
                }
                return (
                  <div className="flex flex-col">
                    {dayNotes.map((n) => (
                      <div
                        key={n.id}
                        className="px-5 py-3.5"
                        style={{ borderTop: "1px solid var(--stroke-divider)" }}
                      >
                        <div
                          className="mb-1 flex items-center gap-2"
                          style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                        >
                          <span
                            style={{
                              fontWeight: "var(--weight-medium)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {n.createdByName ?? "Unknown"}
                          </span>
                          <span>·</span>
                          <span className="tabular">
                            {format(parseISO(n.createdAt), "MM/dd/yyyy h:mm a")}
                          </span>
                        </div>
                        <p
                          className="m-0 whitespace-pre-wrap"
                          style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
                        >
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
              <div
                className="shrink-0 px-5 py-4"
                style={{
                  borderTop: "1px solid var(--stroke-divider)",
                  background: "var(--surface-tertiary)",
                }}
              >
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note…"
                  rows={3}
                  autoFocus
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    onClick={handleSaveNote}
                    disabled={noteSaving || !noteText.trim()}
                  >
                    {noteSaving ? "Saving…" : "Add Note"}
                  </Button>
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
            className="w-full max-w-lg rounded-xl ta-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between gap-3 px-5 py-3.5"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex flex-col gap-0.5">
                <h3 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
                  Add Time Entry
                </h3>
                <p
                  className="m-0"
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                >
                  {timecard?.employee.user?.name ?? timecard?.employee.employeeCode ?? employees.find((e) => e.employeeId === selectedEmployeeId)?.name ?? selectedEmployeeId}
                </p>
              </div>
              <Button
                hierarchy="tertiary"
                size="sm"
                iconOnly
                onClick={() => { setShowAddEntryModal(false); setNewEntryError(null); }}
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={newEntryMode === "hours" ? handleAddHoursEntry : handleAddEntry} className="flex flex-col gap-4 p-5">
              {/* The field grid the document template uses: auto-fit columns
                  that collapse to one at narrow widths, rather than a fixed two
                  that would put a 70px AM/PM select on its own row. */}
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,46%)),1fr))]">
                {/* Date — full width */}
                <div className="col-span-full">
                  <Input
                    label="Date"
                    type="date"
                    value={newEntryDate}
                    onChange={(e) => setNewEntryDate(e.target.value)}
                    required
                    min={format(parseUtcDate((timecard?.payPeriod ?? payPeriods.find((pp) => pp.id === selectedPeriodId))?.startDate ?? new Date().toISOString()), "yyyy-MM-dd")}
                    max={format(parseUtcDate((timecard?.payPeriod ?? payPeriods.find((pp) => pp.id === selectedPeriodId))?.endDate ?? new Date().toISOString()), "yyyy-MM-dd")}
                  />
                </div>

                {/* Two ways to add the same day: the times somebody worked, or
                    a flat number of hours when nobody knows what they were. */}
                <div className="col-span-full">
                  <SegmentedControl
                    fullWidth
                    ariaLabel="How to enter this day"
                    value={newEntryMode}
                    onChange={(next) => {
                      setNewEntryMode(next as "time" | "hours");
                      setNewEntryError(null);
                    }}
                    items={[
                      { value: "time", label: "In / Out Times" },
                      { value: "hours", label: "Reg Hours" },
                    ]}
                  />
                </div>

                {newEntryMode === "time" ? (
                  <>
                    {/* In Time */}
                    <div className="flex items-end gap-1.5">
                      <div className="min-w-0 flex-1">
                      <Input
                        label="In Time"
                        value={newInTimeStr}
                        onChange={(e) => setNewInTimeStr(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                        placeholder="8:00"
                      />
                      </div>
                      <Select
                        value={newInAmPm}
                        onChange={(e) => setNewInAmPm(e.target.value as "AM" | "PM")}
                        aria-label="In time AM or PM"
                        style={{ flex: "none" }}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </Select>
                    </div>
                    {/* Out Time */}
                    <div className="flex items-end gap-1.5">
                      <div className="min-w-0 flex-1">
                      <Input
                        label="Out Time"
                        value={newOutTimeStr}
                        onChange={(e) => setNewOutTimeStr(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                        placeholder="5:00"
                      />
                      </div>
                      <Select
                        value={newOutAmPm}
                        onChange={(e) => setNewOutAmPm(e.target.value as "AM" | "PM")}
                        aria-label="Out time AM or PM"
                        style={{ flex: "none" }}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </Select>
                    </div>
                  </>
                ) : (
                  /* Reg Hours */
                  <div className="col-span-full">
                    <Input
                      label="Reg Hours"
                      type="number"
                      min="0.25"
                      max="24"
                      step="0.25"
                      value={newEntryHours}
                      onChange={(e) => setNewEntryHours(e.target.value)}
                      placeholder="8.00"
                      required
                      hint="Decimal hours, between 0.25 and 24."
                    />
                  </div>
                )}

                {/* Pay Code */}
                {payCodes.length > 0 && (
                  <label className="flex flex-col gap-1.5">
                    <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>
                      Pay Code
                    </span>
                    <Select
                      value={newEntryPayCodeId}
                      onChange={(e) => setNewEntryPayCodeId(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      <option value="">— Default —</option>
                      {payCodes.map((pc) => (
                        <option key={pc.id} value={pc.id}>{pc.code}[{pc.label}]</option>
                      ))}
                    </Select>
                  </label>
                )}
                {/* Reason code dropdown */}
                {reasonCodes.length > 0 && (
                  <label className="flex flex-col gap-1.5">
                    <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>
                      Reason
                    </span>
                    <Select
                      value={newEntryReasonCodeId}
                      onChange={(e) => setNewEntryReasonCodeId(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      <option value="">—</option>
                      {reasonCodes.map((rc) => (
                        <option key={rc.id} value={rc.id}>{rc.code} — {rc.label}</option>
                      ))}
                    </Select>
                  </label>
                )}
                {/* Notes — full width, saved as timesheet note */}
                <div className="col-span-full">
                  <Input
                    label="Notes"
                    value={newEntryNote}
                    onChange={(e) => setNewEntryNote(e.target.value)}
                    placeholder="Add a note for this entry…"
                  />
                </div>
              </div>
              {newEntryError && <Banner tone="error" body={newEntryError} />}
              <div
                className="flex justify-end gap-2 pt-4"
                style={{ borderTop: "1px solid var(--stroke-divider)" }}
              >
                <Button
                  hierarchy="secondary"
                  onClick={() => { setShowAddEntryModal(false); setNewEntryError(null); }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending || (newEntryMode === "time" ? (!newInTimeStr || !newOutTimeStr) : !newEntryHours)}
                >
                  {isPending ? "Adding…" : "Add Entry"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
