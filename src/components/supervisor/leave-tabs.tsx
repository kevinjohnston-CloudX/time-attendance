"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { AlertTriangle, CalendarOff, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  Badge,
  Banner,
  Button,
  Card,
  FilterSelectChip,
  LinkButton,
  SearchInput,
  SegmentedControl,
  Toast,
  useToast,
  Select,
  Textarea,
  leaveTone,
} from "@/components/ui";
import { LeaveApprovalButtons } from "@/components/supervisor/leave-approval-buttons";
import { LeaveReverseButton } from "@/components/supervisor/leave-reverse-button";
import { HrApproveButtons } from "@/components/supervisor/hr-approve-buttons";
import { LEAVE_STATUS_LABEL, type LeaveRequestStatusValue } from "@/lib/state-machines/labels";
import { getTeamMembersForLeave, createLeaveRequestForEmployee } from "@/actions/leave.actions";
import { LeaveDayPicker, type DaySelection, type ShiftInfo } from "@/components/leave/leave-day-picker";

/**
 * Team Leave, as the portal design lays it out: the list screen's header,
 * toolbar and filter chips, then the requests beside the coverage calendar
 * they have to be judged against.
 *
 * <p>The two sit side by side rather than on separate screens because the
 * question this page answers is never "is this request reasonable" on its own
 * — it is "who else is already off those days". Splitting them is what made
 * approvals arrive at a Tuesday with three people out.
 */

// @db.Date fields arrive from the server as ISO strings at UTC midnight.
// Extract YYYY-MM-DD and parseISO to get local midnight — avoids timezone day shift.
function parseLeaveDate(d: Date | string): Date {
  const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  return parseISO(s);
}

interface LeaveRequestRow {
  id: string;
  employeeId: string;
  startDate: Date | string;
  endDate: Date | string;
  durationMinutes: number;
  status: string;
  note: string | null;
  submittedAt: Date | string | null;
  employee: {
    user: { name: string | null } | null;
    department: { id: string; name: string } | null;
  };
  leaveType: { name: string };
}

/** Which queue a row came from. The All view mixes all three. */
type Queue = "pending" | "hr-pending" | "upcoming";

/** Active headcount in the approver's scope, for the coverage figure. */
interface Headcount {
  total: number;
  byDepartment: { id: string; name: string; count: number }[];
}

interface LeaveTabsProps {
  pending: LeaveRequestRow[];
  hrPending: LeaveRequestRow[];
  upcoming: LeaveRequestRow[];
  headcount: Headcount;
  initialTab?: "pending" | "hr-pending" | "upcoming";
  canFilter?: boolean;
  canHrApprove?: boolean;
  canSubmitLeave?: boolean;
  sites?: { id: string; name: string }[];
  departments?: { id: string; name: string }[];
  shifts?: { id: string; name: string }[];
  selectedSiteId?: string;
  selectedDepartmentId?: string;
  selectedShiftId?: string;
}

type Tab = "all" | "pending" | "hr-pending" | "upcoming";

/**
 * How many cards are drawn before the person asks for more.
 *
 * <p>A site with several hundred people can put a few hundred requests in the
 * All view, and every card carries its own buttons and its own transition. The
 * queue is worked from the top, so drawing the whole thing costs a slow first
 * paint to render rows nobody scrolls to.
 */
const PAGE_SIZE = 25;

/**
 * A filter combination somebody wants back tomorrow.
 *
 * <p>Held in this browser rather than the database. A saved view is one
 * person's shortcut, and putting it in the browser means it works today
 * without a schema change on a live system. The cost is honest and worth
 * stating: it does not follow the person to another machine, and it is not
 * shared with anybody.
 */
type SavedView = {
  name: string;
  tab: Tab;
  query: string;
  siteId?: string;
  departmentId?: string;
  shiftId?: string;
};

const SAVED_VIEWS_KEY = "cloudtime.teamLeave.savedViews";
const SAVED_VIEWS_EVENT = "cloudtime:saved-views";

/**
 * The parse is cached against the raw string because useSyncExternalStore
 * compares snapshots by identity: returning a freshly parsed array on every
 * read would tell React the value changed on every render, forever.
 */
const EMPTY_VIEWS: SavedView[] = [];
let cachedRaw: string | null = null;
let cachedViews: SavedView[] = EMPTY_VIEWS;

function readSavedViews(): SavedView[] {
  let raw = "";
  try {
    raw = window.localStorage.getItem(SAVED_VIEWS_KEY) ?? "";
  } catch {
    // Private windows, cleared site data and blocked storage all land here.
    // A saved view is a convenience, so losing it must never break the page.
    return EMPTY_VIEWS;
  }
  if (raw === cachedRaw) return cachedViews;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedViews = Array.isArray(parsed) ? (parsed as SavedView[]) : EMPTY_VIEWS;
  } catch {
    cachedViews = EMPTY_VIEWS;
  }
  return cachedViews;
}

/** Nothing is saved on the server, so the first paint matches an empty list. */
function readSavedViewsOnServer(): SavedView[] {
  return EMPTY_VIEWS;
}

function subscribeToSavedViews(onChange: () => void): () => void {
  // "storage" covers this page's other tabs; the custom event covers this one,
  // because a tab does not receive its own storage event.
  window.addEventListener("storage", onChange);
  window.addEventListener(SAVED_VIEWS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SAVED_VIEWS_EVENT, onChange);
  };
}

function writeSavedViews(views: SavedView[]) {
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    /* storage unavailable, so the view simply does not persist */
  }
  window.dispatchEvent(new Event(SAVED_VIEWS_EVENT));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * What a calendar day looks like once you know who is off on it.
 *
 * <p>Severity, not variety: a day where a pending request lands on top of
 * somebody else's approved leave is the only one that needs a decision, so it
 * is the only red. Everything else is a shade of "noted". The three entries
 * are semantic token triples rather than colours, so the calendar flips with
 * the theme along with everything else.
 */
const DAY_TONE = {
  conflict: { bg: "var(--surface-error)",   line: "var(--stroke-error)",     fg: "var(--text-error)" },
  pending:  { bg: "var(--surface-warning)", line: "var(--stroke-warning)",   fg: "var(--text-warning)" },
  approved: { bg: "var(--surface-success)", line: "var(--stroke-success)",   fg: "var(--text-success)" },
} as const;

/** First name only — a calendar cell is about six characters wide. */
function shortName(name: string): string {
  return name.split(" ")[0];
}

export function LeaveTabs({
  pending,
  hrPending,
  upcoming,
  headcount,
  initialTab,
  canFilter,
  canHrApprove,
  canSubmitLeave,
  sites = [],
  departments = [],
  shifts = [],
  selectedSiteId,
  selectedDepartmentId,
  selectedShiftId,
}: LeaveTabsProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab ?? "pending");
  // Name search is the design's addition. It filters rows already fetched, so
  // it never re-queries and never widens what this person is allowed to see.
  const [query, setQuery] = useState("");
  // Which card is expanded in the coverage panel. The design selects a request
  // and shows its days on the calendar.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The coverage panel reads one department at a time by default, because
  // "who else is off" is a question about the people who cover the same work.
  const [deptOnly, setDeptOnly] = useState(true);
  const [shown, setShown] = useState(PAGE_SIZE);

  /**
   * The toolbar pins to the top, so the coverage panel has to pin below it
   * rather than at a guessed offset. The toolbar's height is not a constant:
   * the chips wrap onto a second line on a narrow window, and the "Clear all"
   * link appears and disappears. Measuring it is what the handoff does too.
   */
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(96);

  /**
   * True once the page has scrolled, which shrinks the title and drops the
   * counts so the pinned bar costs less height without ever leaving the screen
   * unnamed.
   *
   * <p>Measured as the distance the pinned bar has travelled from a marker at
   * the top of the page. The marker scrolls away while the bar stays put, so
   * the gap between them is how far the page has scrolled, whichever element
   * is doing the scrolling.
   *
   * <p>The marker is positioned absolutely on purpose. Sticky elements can
   * only travel within their own parent, so wrapping the bar in something to
   * measure against pins it to a box its own height and it never moves at all.
   * Out of flow, the marker also costs no height and no column gap.
   *
   * <p>Condensing never moves the marker, which sits above the header, so the
   * measurement cannot move itself and cannot oscillate.
   */
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    let frame = 0;

    const read = () => {
      frame = 0;
      const bar = toolbarRef.current;
      const marker = markerRef.current;
      if (!bar || !marker) return;
      const travelled = bar.getBoundingClientRect().top - marker.getBoundingClientRect().top;
      setCondensed((prev) => (prev ? travelled > 4 : travelled > 16));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };

    // Captured on the document, because scroll events do not bubble: this
    // catches the portal's inner scroller, the window, and anything else,
    // without having to work out which one it is.
    read();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const measureToolbar = useCallback(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const h = Math.round(el.getBoundingClientRect().height);
    if (h) setToolbarHeight((prev) => (prev === h ? prev : h));
  }, []);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measureToolbar);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureToolbar]);
  const { message: toast, flash } = useToast();
  // Storage is an external store, so it is read as one. This also keeps two
  // open tabs in step without either of them polling.
  const savedViews = useSyncExternalStore(
    subscribeToSavedViews,
    readSavedViews,
    readSavedViewsOnServer,
  );

  type TeamEmployee = {
    id: string;
    wmsId: string | null;
    user: { name: string | null } | null;
    shift: { startTime: string; endTime: string; workDays: number[]; mealConfig: unknown } | null;
  };

  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [teamEmployees, setTeamEmployees] = useState<TeamEmployee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string }[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);

  // Form state
  const [targetEmployeeId, setTargetEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [selectedDays, setSelectedDays] = useState<DaySelection[]>([]);
  const [note, setNote] = useState("");

  const selectedEmployee = teamEmployees.find((e) => e.id === targetEmployeeId) ?? null;
  const shift: ShiftInfo | null = selectedEmployee?.shift
    ? {
        startTime: selectedEmployee.shift.startTime,
        endTime: selectedEmployee.shift.endTime,
        workDays: selectedEmployee.shift.workDays,
        mealBreakMinutes: (selectedEmployee.shift.mealConfig as { deductMinutes?: number } | null)?.deductMinutes ?? null,
      }
    : null;

  async function openSubmitModal() {
    setShowSubmitModal(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    if (teamEmployees.length === 0) {
      setLoadingTeam(true);
      try {
        const result = await getTeamMembersForLeave();
        if (result.success) {
          setTeamEmployees(result.data.employees as TeamEmployee[]);
          setLeaveTypes(result.data.leaveTypes);
          if (result.data.employees.length > 0) setTargetEmployeeId(result.data.employees[0].id);
          if (result.data.leaveTypes.length > 0) setLeaveTypeId(result.data.leaveTypes[0].id);
        }
      } catch { /* swallow */ }
      setLoadingTeam(false);
    }
  }

  function closeModal() {
    setShowSubmitModal(false);
    setSubmitError(null);
    setSubmitSuccess(false);
    setSelectedDays([]);
    setNote("");
  }

  function handleEmployeeChange(id: string) {
    setTargetEmployeeId(id);
    setSelectedDays([]); // reset days when employee changes — shift may differ
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (selectedDays.length === 0) { setSubmitError("Select at least one day."); return; }

    startTransition(async () => {
      try {
        const result = await createLeaveRequestForEmployee({
          targetEmployeeId,
          leaveTypeId,
          selectedDays,
          note: note || undefined,
        });
        if (result.success) {
          setSubmitSuccess(true);
          setSelectedDays([]);
          setNote("");
          router.refresh();
        } else {
          setSubmitError(result.error);
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Failed to submit leave request.");
      }
    });
  }

  /**
   * The site and department filters live in the query string, not in state.
   * A filtered leave list has to survive a reload and be sendable to whoever
   * asked "who is out in Packing next week" — React state is neither.
   */
  function hrefFor(next: { siteId?: string; departmentId?: string; shiftId?: string }) {
    const params = new URLSearchParams();
    if (next.siteId) params.set("siteId", next.siteId);
    if (next.departmentId) params.set("departmentId", next.departmentId);
    if (next.shiftId) params.set("shiftId", next.shiftId);
    params.set("tab", tab);
    return `/supervisor/leave?${params.toString()}`;
  }

  function navigate(next: { siteId?: string; departmentId?: string; shiftId?: string }) {
    router.push(hrefFor(next));
  }

  /** The export carries the filters the person is looking at, not everything. */
  function exportUrl() {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (selectedSiteId) params.set("siteId", selectedSiteId);
    if (selectedDepartmentId) params.set("departmentId", selectedDepartmentId);
    if (selectedShiftId) params.set("shiftId", selectedShiftId);
    return `/api/reports/team-leave?${params.toString()}`;
  }

  /**
   * A name built from what is actually filtered, so a saved view says what it
   * is without asking the person to name it in a dialog.
   */
  function describeCurrentView(): string {
    const parts: string[] = [
      tab === "all"
        ? "All requests"
        : tab === "pending"
          ? "Pending"
          : tab === "hr-pending"
            ? "HR review"
            : "Approved",
    ];
    if (selectedSiteId) parts.push(siteName ?? "Site");
    if (selectedDepartmentId) parts.push(deptName ?? "Department");
    if (selectedShiftId) parts.push(shiftName ?? "Shift");
    if (query.trim()) parts.push(`"${query.trim()}"`);
    return parts.join(", ");
  }

  function saveCurrentView() {
    const view: SavedView = {
      name: describeCurrentView(),
      tab,
      query: query.trim(),
      siteId: selectedSiteId,
      departmentId: selectedDepartmentId,
      shiftId: selectedShiftId,
    };
    // Saving the same combination twice replaces it rather than stacking
    // duplicates that read identically and cannot be told apart.
    const next = [view, ...savedViews.filter((v) => v.name !== view.name)].slice(0, 8);
    writeSavedViews(next);
    flash(`View saved: ${view.name}`);
  }

  function applyView(view: SavedView) {
    setTab(view.tab);
    setQuery(view.query);
    setSelectedId(null);
    router.push(hrefFor({
      siteId: view.siteId,
      departmentId: view.departmentId,
      shiftId: view.shiftId,
    }));
  }

  function removeView(name: string) {
    writeSavedViews(savedViews.filter((v) => v.name !== name));
  }

  const [calMonth, setCalMonth] = useState(() => new Date());
  const [tooltip, setTooltip] = useState<{
    top: number;
    left: number;
    approved: { name: string; leaveType: string }[];
    pending: { name: string; leaveType: string }[];
    hasConflict: boolean;
    date: Date;
  } | null>(null);

  // Build date → { name, employeeId, leaveType } maps
  type Entry = {
    name: string;
    employeeId: string;
    leaveType: string;
    departmentId: string | null;
  };
  const approvedMap = new Map<string, Entry[]>();
  for (const req of upcoming) {
    const days = eachDayOfInterval({ start: parseLeaveDate(req.startDate), end: parseLeaveDate(req.endDate) });
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      if (!approvedMap.has(key)) approvedMap.set(key, []);
      approvedMap.get(key)!.push({
        name: req.employee.user?.name ?? "Unknown",
        employeeId: req.employeeId,
        leaveType: req.leaveType.name,
        departmentId: req.employee.department?.id ?? null,
      });
    }
  }

  const pendingMap = new Map<string, Entry[]>();
  for (const req of pending) {
    const days = eachDayOfInterval({ start: parseLeaveDate(req.startDate), end: parseLeaveDate(req.endDate) });
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      if (!pendingMap.has(key)) pendingMap.set(key, []);
      pendingMap.get(key)!.push({
        name: req.employee.user?.name ?? "Unknown",
        employeeId: req.employeeId,
        leaveType: req.leaveType.name,
        departmentId: req.employee.department?.id ?? null,
      });
    }
  }

  /**
   * Which pending requests overlap approved leave belonging to somebody else,
   * and who that somebody is.
   *
   * <p>The screen used to say only that an overlap existed. "Overlap" with no
   * name behind it sends you to the calendar to work out who, which is the one
   * thing the supervisor was going to ask next every single time.
   */
  const conflictNames = new Map<string, string[]>();
  for (const req of pending) {
    const names = new Set<string>();
    const days = eachDayOfInterval({ start: parseLeaveDate(req.startDate), end: parseLeaveDate(req.endDate) });
    for (const day of days) {
      for (const a of approvedMap.get(format(day, "yyyy-MM-dd")) ?? []) {
        if (a.employeeId !== req.employeeId) names.add(a.name);
      }
    }
    if (names.size > 0) conflictNames.set(req.id, [...names]);
  }

  // Calendar grid spanning full weeks of the visible month
  const gridDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(calMonth)),
    end: endOfWeek(endOfMonth(calMonth)),
  });

  /**
   * Every row carries the queue it came from, because the All view mixes the
   * three and each queue has its own actions. Without this a row in All would
   * not know whether it offers Approve, the HR signature, or Reverse.
   */
  const tagged: { req: LeaveRequestRow; queue: Queue }[] =
    tab === "pending"
      ? pending.map((req) => ({ req, queue: "pending" as const }))
      : tab === "hr-pending"
        ? hrPending.map((req) => ({ req, queue: "hr-pending" as const }))
        : tab === "upcoming"
          ? upcoming.map((req) => ({ req, queue: "upcoming" as const }))
          : [
              ...pending.map((req) => ({ req, queue: "pending" as const })),
              ...hrPending.map((req) => ({ req, queue: "hr-pending" as const })),
              ...upcoming.map((req) => ({ req, queue: "upcoming" as const })),
            ];

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? tagged.filter((t) => (t.req.employee.user?.name ?? "").toLowerCase().includes(needle))
    : tagged;

  const rows = visible.map((t) => t.req);

  /**
   * The request the coverage panel is answering for. The design always has one
   * in focus, so an unclicked page still means something: it falls back to the
   * first row rather than showing an empty panel nobody can interpret.
   */
  const focused: LeaveRequestRow | null =
    rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;

  const focusedDept = focused?.employee.department ?? null;
  /** Narrowing to a department needs a department to narrow to. */
  const scopedToDept = deptOnly && !!focusedDept;

  const focusedDays = focused
    ? eachDayOfInterval({
        start: parseLeaveDate(focused.startDate),
        end: parseLeaveDate(focused.endDate),
      }).map((d) => format(d, "yyyy-MM-dd"))
    : [];
  const focusedDaySet = new Set(focusedDays);

  const inScope = (e: Entry) => !scopedToDept || e.departmentId === focusedDept!.id;

  /**
   * Everyone off on the focused request's days, counted once each however many
   * of those days they are out for. Pending counts too: the question before
   * approving is how thin the floor gets if this one is said yes to, and a
   * figure that ignored the other requests in the queue would answer a
   * different question.
   */
  const offOnFocusedDays = new Set<string>();
  for (const key of focusedDays) {
    for (const e of approvedMap.get(key) ?? []) if (inScope(e)) offOnFocusedDays.add(e.employeeId);
    for (const e of pendingMap.get(key) ?? []) if (inScope(e)) offOnFocusedDays.add(e.employeeId);
  }

  const scopeSize = scopedToDept
    ? (headcount.byDepartment.find((d) => d.id === focusedDept!.id)?.count ?? 0)
    : headcount.total;
  const offCount = offOnFocusedDays.size;
  const onShift = Math.max(scopeSize - offCount, 0);
  const scopeName = scopedToDept ? focusedDept!.name : "the team";
  // Three or more out together is the point the design flags, and it matches
  // the shading already used on the calendar cells.
  const coverageTight = offCount >= 3;
  /** No headcount means no denominator, so the figure is withheld rather than guessed. */
  const coverageKnown = scopeSize > 0 && !!focused;
  // The page only passes siteId/departmentId into the three queries when
  // canFilter is true, so a ?siteId= left in the URL by somebody without that
  // permission narrows nothing. A chip for it would claim a filter the rows
  // underneath were never filtered by, and would turn a genuinely empty queue
  // into "nothing matches your filters".
  const isFiltered = !!(canFilter && (selectedSiteId || selectedDepartmentId || selectedShiftId));

  const siteName = sites.find((s) => s.id === selectedSiteId)?.name ?? selectedSiteId;
  const deptName = departments.find((d) => d.id === selectedDepartmentId)?.name ?? selectedDepartmentId;
  const shiftName = shifts.find((sh) => sh.id === selectedShiftId)?.name ?? selectedShiftId;

  const LIST_CARD: Record<Tab, { title: string; subtitle: string; empty: string; emptyBody: string }> = {
    all: {
      title: "All Requests",
      subtitle: "Everything on your team, whichever stage it has reached",
      empty: "No leave requests",
      emptyBody: "Nothing has been filed for your team yet.",
    },
    pending: {
      title: "Awaiting Your Decision",
      subtitle: "Oldest first — the ones people have been waiting on longest",
      empty: "No pending leave requests",
      emptyBody: "Nothing on your team is waiting for a decision right now.",
    },
    "hr-pending": {
      title: "With HR",
      subtitle: "Approved by a supervisor, waiting on the second signature",
      empty: "Nothing awaiting HR review",
      emptyBody: "Everything you have approved has been through HR.",
    },
    upcoming: {
      title: "Approved & Upcoming",
      subtitle: "Ending today or later",
      empty: "No upcoming approved leave",
      emptyBody: "Nobody on your team is booked off from today onwards.",
    },
  };

  return (
    <div className="relative flex flex-col gap-4">
      <span
        ref={markerRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-px w-px"
      />

      {/* The whole top of the page pins, not just the filters. Scrolling a
          queue of several hundred used to take the title, the actions and the
          filters off the screen together. Built here rather than with the
          shared PageHeader because this one has to shrink, which that
          component does not do. */}
      <div
        ref={toolbarRef}
        className="sticky top-0 z-20 flex flex-col"
        style={{ background: "var(--surface-page)" }}
      >
        <div
          className="flex flex-wrap items-end gap-3"
          style={{
            paddingTop: condensed ? 8 : 0,
            paddingBottom: condensed ? 8 : 12,
            transition: "padding 140ms ease",
          }}
        >
          <div className="flex min-w-60 flex-1 flex-col gap-0.5">
            <h1
              style={{
                margin: 0,
                // Shrinks to the page-title step rather than disappearing, so
                // there is always something naming the screen you are in.
                fontSize: condensed ? 20 : 30,
                lineHeight: condensed ? "26px" : "36px",
                fontWeight: "var(--weight-bold)",
                letterSpacing: "-0.02em",
                color: "var(--text-primary)",
                transition: "font-size 140ms ease, line-height 140ms ease",
              }}
            >
              Leave Requests
            </h1>
            {/* The counts are orientation, not navigation, so they are the
                first thing to go when space is short. */}
            {!condensed && (
              <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                {`${pending.length} awaiting you \u00b7 ${hrPending.length} with HR \u00b7 ${upcoming.length} approved upcoming`}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <LinkButton href="/supervisor" hierarchy="tertiary">
              ← Team Portal
            </LinkButton>
            <Button
              hierarchy="secondary"
              onClick={() => {
                // A normal navigation: the route answers with an attachment,
                // so the browser downloads it and the page stays put.
                window.location.assign(exportUrl());
                flash("Preparing your download");
              }}
            >
              Export
            </Button>
            {canSubmitLeave && (
              <Button onClick={openSubmitModal} leadingIcon={<Plus className="h-4 w-4" />}>
                Submit Leave
              </Button>
            )}
          </div>
        </div>

        {/* One row, not two: the views, the search and the three filters sit
            together so the pinned bar costs as little height as possible. It
            still wraps on a narrow window rather than overflowing. */}
        <div className="flex flex-wrap items-center gap-2.5 pb-3">
          {/* Stays a SegmentedControl rather than the URL-backed
              SegmentedLinks: each tab is a separate permission-scoped query
              the server has already run, so switching filters rows in hand
              rather than re-fetching. The ?tab= parameter still picks the
              opening tab, which the dashboard's link relies on. */}
          <SegmentedControl
            ariaLabel="Leave view"
            size="sm"
            items={[
              { value: "all", label: "All", count: pending.length + hrPending.length + upcoming.length },
              { value: "pending", label: "Pending", count: pending.length },
              { value: "hr-pending", label: "HR Review", count: hrPending.length },
              { value: "upcoming", label: "Approved", count: upcoming.length },
            ]}
            value={tab}
            onChange={(v) => {
              setTab(v as Tab);
              setSelectedId(null);
              setShown(PAGE_SIZE);
            }}
          />

          <SearchInput
            aria-label="Search by employee name"
            placeholder="Employee name"
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setShown(PAGE_SIZE);
            }}
          />

          {/* Department, shift, then site, in the handoff's order. Each clears
              from inside its own pill rather than from a second row repeating
              the same filters. */}
          {canFilter && (
            <FilterSelectChip
              label="Department"
              value={selectedDepartmentId ?? ""}
              options={departments}
              disabled={departments.length === 0}
              onChange={(id) =>
                navigate({
                  siteId: selectedSiteId,
                  departmentId: id || undefined,
                  shiftId: selectedShiftId,
                })
              }
            />
          )}
          {canFilter && shifts.length > 0 && (
            <FilterSelectChip
              label="Shift"
              value={selectedShiftId ?? ""}
              options={shifts}
              onChange={(id) =>
                navigate({
                  siteId: selectedSiteId,
                  departmentId: selectedDepartmentId,
                  shiftId: id || undefined,
                })
              }
            />
          )}
          {/* Changing the site clears the department with it: the department
              list the server offers is scoped to the chosen site, so one left
              behind would filter by something no longer on the screen. */}
          {canFilter && sites.length > 0 && (
            <FilterSelectChip
              label="Site"
              value={selectedSiteId ?? ""}
              options={sites}
              onChange={(id) => navigate({ siteId: id || undefined, shiftId: selectedShiftId })}
            />
          )}

          {(isFiltered || query.trim()) && (
            <Button
              hierarchy="link"
              size="sm"
              onClick={() => {
                setQuery("");
                setShown(PAGE_SIZE);
                if (isFiltered) navigate({});
              }}
            >
              Clear all
            </Button>
          )}

          <span
            className="tabular ml-auto whitespace-nowrap"
            style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
          >
            {rows.length} {rows.length === 1 ? "request" : "requests"}
          </span>

          <Button hierarchy="link" size="sm" onClick={saveCurrentView}>
            Save current view
          </Button>
        </div>
      </div>

      {/* A saved view is only worth saving if it can be got back, so the
          design's single link grows the row that returns you to one. */}
      {savedViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
            Saved views
          </span>
          {savedViews.map((v) => (
            <span key={v.name} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => applyView(v)}
                className="ta-chip truncate"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 28,
                  maxWidth: 260,
                  padding: "0 8px 0 10px",
                  boxSizing: "border-box",
                  whiteSpace: "nowrap",
                  borderRadius: "999px 0 0 999px",
                  border: "1px solid var(--stroke-secondary)",
                  borderRight: "none",
                  background: "var(--surface-card)",
                  font: "var(--type-body2)",
                  fontWeight: "var(--weight-medium)",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => removeView(v.name)}
                aria-label={`Remove saved view ${v.name}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 28,
                  padding: "0 9px 0 5px",
                  boxSizing: "border-box",
                  borderRadius: "0 999px 999px 0",
                  border: "1px solid var(--stroke-secondary)",
                  background: "var(--surface-card)",
                  color: "var(--icon-tertiary)",
                  cursor: "pointer",
                  lineHeight: 0,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(360px,42%)),1fr))]">
        {/* ── The requests ─────────────────────────────────────────────── */}
        {/* The list is a stack of selectable cards, as the design lays it
            out, rather than one card of divided rows. Selecting a card drives
            the coverage panel beside it. */}
        <div className="flex min-w-0 flex-col gap-2.5">
          {rows.length === 0 ? (
            <div
              className="flex flex-col items-center gap-2.5 px-6 py-12 text-center"
              style={{
                border: "1px solid var(--stroke-secondary)",
                borderRadius: 12,
                background: "var(--surface-card)",
              }}
            >
              <span style={{ color: "var(--icon-disabled)" }}>
                <CalendarOff className="h-8 w-8" />
              </span>
              <div style={{ font: "var(--type-h4)" }}>
                {needle ? "No matching requests" : LIST_CARD[tab].empty}
              </div>
              <div
                className="max-w-80"
                style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
              >
                {needle
                  ? `Nobody on this list is called "${query.trim()}". Clear the search to see the rest.`
                  : isFiltered
                    ? "Nothing matches the site and department you have filtered to. Clear the filters to see the whole team."
                    : LIST_CARD[tab].emptyBody}
              </div>
              {needle && (
                <Button hierarchy="secondary" size="sm" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <>
              {sortForTab(visible, tab)
                .slice(0, shown)
                .map(({ req, queue }) => (
                  <RequestCard
                    key={req.id}
                    req={req}
                    queue={queue}
                    canHrApprove={!!canHrApprove}
                    conflictWith={conflictNames.get(req.id)}
                    selected={req.id === focused?.id}
                    onSelect={() => {
                      const next = req.id === selectedId ? null : req.id;
                      setSelectedId(next);
                      // Jumping the calendar to the request saves the
                      // supervisor paging to it by hand, which was the point
                      // of selecting it.
                      if (next) setCalMonth(startOfMonth(parseLeaveDate(req.startDate)));
                    }}
                  />
                ))}

              {/* A long queue is drawn a screenful at a time. The count is
                  always visible, so nobody reads the bottom of a truncated
                  list as the end of the queue. */}
              {rows.length > shown && (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 px-1 py-1"
                >
                  <span
                    className="tabular"
                    style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                  >
                    Showing {shown} of {rows.length}
                  </span>
                  <Button
                    hierarchy="secondary"
                    size="sm"
                    onClick={() => setShown((n) => n + PAGE_SIZE)}
                  >
                    Show {Math.min(PAGE_SIZE, rows.length - shown)} more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Coverage ─────────────────────────────────────────────────── */}
        <div className="sticky min-w-0" style={{ top: toolbarHeight + 14 }}>
        <Card
          title="Coverage"
          subtitle={
            focused
              ? `${scopedToDept ? focusedDept!.name : "All departments"}, around ${
                  focused.employee.user?.name ?? "the selected request"
                }`
              : tab === "pending"
                ? "Approved leave, with pending requests laid over it"
                : "Approved leave for the team"
          }
          actions={
            <div className="flex items-center gap-1">
              <Button
                hierarchy="secondary"
                size="sm"
                iconOnly
                aria-label="Previous month"
                onClick={() => setCalMonth((m) => subMonths(m, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span
                className="text-center"
                style={{ minWidth: 132, font: "var(--type-h4)", color: "var(--text-primary)" }}
              >
                {format(calMonth, "MMMM yyyy")}
              </span>
              <Button
                hierarchy="secondary"
                size="sm"
                iconOnly
                aria-label="Next month"
                onClick={() => setCalMonth((m) => addMonths(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button hierarchy="tertiary" size="sm" onClick={() => setCalMonth(new Date())}>
                Today
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-2.5">
            {/* The coverage line. It answers "can I say yes to this" before the
                grid is read at all, which is the whole reason the panel sits
                beside the queue rather than under it. */}
            {coverageKnown && (
              <div
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg px-3 py-2.5"
                style={{
                  background: coverageTight ? "var(--surface-warning)" : "var(--surface-success)",
                  color: coverageTight ? "var(--text-warning)" : "var(--text-success)",
                }}
              >
                <span
                  className="tabular whitespace-nowrap"
                  style={{ font: "var(--weight-bold) 18px/22px var(--font-sans)" }}
                >
                  {onShift} of {scopeSize} on shift
                </span>
                <span
                  className="min-w-0 flex-1"
                  style={{
                    font: "var(--type-body2)",
                    fontWeight: "var(--weight-medium)",
                    textWrap: "pretty",
                  }}
                >
                  {offCount === 0
                    ? `Nobody in ${scopeName} is off on those days`
                    : coverageTight
                      ? `${offCount} people off in ${scopeName} on these days. Check before approving.`
                      : `Coverage stays within target for ${scopeName}`}
                </span>
              </div>
            )}

            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="wms-overline py-1.5 text-center">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {gridDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const approvedEntries = (approvedMap.get(key) ?? []).filter(inScope);
                const pendingEntries =
                  tab === "pending" ? (pendingMap.get(key) ?? []).filter(inScope) : [];
                // The days the focused request covers, outlined so the request
                // under decision is findable in the month at a glance.
                const inFocusedRequest = focusedDaySet.has(key);
                const inMonth = day.getMonth() === calMonth.getMonth();
                const todayDay = isToday(day);

                // Conflict = pending leave on this day AND approved leave from a different employee
                const hasConflict =
                  pendingEntries.length > 0 &&
                  approvedEntries.some((a) => pendingEntries.some((p) => p.employeeId !== a.employeeId));

                const total = approvedEntries.length + pendingEntries.length;
                const tone = hasConflict
                  ? DAY_TONE.conflict
                  : pendingEntries.length > 0
                    ? DAY_TONE.pending
                    : approvedEntries.length > 0
                      ? DAY_TONE.approved
                      : null;

                // Pending names come first because only two fit and they are the
                // ones under decision — a cell that showed the two approved
                // people and hid the request behind "+1 more" would hide the
                // only name the supervisor is here to act on. The dot says
                // which queue each one is in; the tint alone cannot.
                const names = [
                  ...pendingEntries.map((e) => ({
                    name: e.name,
                    dot: hasConflict ? "var(--fill-error)" : "var(--fill-warning)",
                  })),
                  ...approvedEntries.map((e) => ({ name: e.name, dot: "var(--fill-success)" })),
                ];

                return (
                  <div
                    key={key}
                    className="flex min-h-[4.5rem] flex-col gap-1 rounded-md p-1.5"
                    style={{
                      // The focused request's own days outrank the tint: the
                      // supervisor has to see which days they are deciding on
                      // even when those days are already busy.
                      border: `1px solid ${
                        inFocusedRequest
                          ? "var(--stroke-accent)"
                          : tone
                            ? tone.line
                            : "var(--stroke-secondary)"
                      }`,
                      outline: inFocusedRequest ? "1px solid var(--stroke-accent)" : undefined,
                      background: tone
                        ? tone.bg
                        : inFocusedRequest
                          ? "var(--surface-info)"
                          : inMonth
                            ? "var(--surface-card)"
                            : "transparent",
                      // Out-of-month days are dimmed rather than hidden: a
                      // request that runs over a month boundary has to stay
                      // visible on both sides of it.
                      opacity: inMonth || inFocusedRequest ? 1 : total > 0 ? 0.6 : 0.4,
                    }}
                    onMouseEnter={
                      total > 0
                        ? (e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTooltip({
                              top: rect.bottom + 6,
                              left: Math.min(rect.left, window.innerWidth - 220),
                              approved: approvedEntries.map((x) => ({ name: x.name, leaveType: x.leaveType })),
                              pending: pendingEntries.map((x) => ({ name: x.name, leaveType: x.leaveType })),
                              hasConflict,
                              date: day,
                            });
                          }
                        : undefined
                    }
                    onMouseLeave={() => setTooltip(null)}
                  >
                    <div className="flex items-center gap-1">
                      <span
                        className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1"
                        style={{
                          font: "var(--type-body2)",
                          fontWeight: todayDay || tone ? "var(--weight-semibold)" : undefined,
                          background: todayDay ? "var(--fill-accent)" : undefined,
                          color: todayDay
                            ? "var(--text-on-accent)"
                            : tone
                              ? tone.fg
                              : inMonth
                                ? "var(--text-primary)"
                                : "var(--text-tertiary)",
                        }}
                      >
                        {format(day, "d")}
                      </span>
                      {total > 0 && (
                        <span
                          className="tabular ml-auto"
                          style={{ font: "var(--type-caption2)", color: "var(--text-secondary)" }}
                        >
                          {total}
                        </span>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-col gap-0.5">
                      {names.slice(0, 2).map((n, i) => (
                        <span
                          key={i}
                          className="flex min-w-0 items-center gap-1"
                          style={{ font: "var(--type-caption1)", color: "var(--text-secondary)" }}
                        >
                          <span
                            aria-hidden="true"
                            className="flex-none rounded-full"
                            style={{ width: 5, height: 5, background: n.dot }}
                          />
                          <span className="truncate">{shortName(n.name)}</span>
                        </span>
                      ))}
                      {names.length > 2 && (
                        <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                          +{names.length - 2} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2.5"
              style={{
                borderTop: "1px solid var(--stroke-divider)",
                font: "var(--type-body2)",
                color: "var(--text-secondary)",
              }}
            >
              <Swatch label="Approved" bg="var(--surface-success)" line="var(--stroke-success)" />
              {tab === "pending" && (
                <>
                  <Swatch label="Pending" bg="var(--surface-warning)" line="var(--stroke-warning)" />
                  <Swatch
                    label="Overlaps approved leave"
                    bg="var(--surface-error)"
                    line="var(--stroke-error)"
                  />
                </>
              )}
              {/* Not "fully staffed": these queries know who has leave, not who is
                  rostered, so an untinted day means nobody is booked off — it does
                  not mean the floor is covered. */}
              <Swatch label="Nobody off" bg="var(--surface-card)" line="var(--stroke-secondary)" />
              {focused && (
                <Swatch
                  label="Days in this request"
                  bg="var(--surface-info)"
                  line="var(--stroke-accent)"
                />
              )}
              {focusedDept && (
                <span className="ml-auto">
                  <Button
                    hierarchy="secondary"
                    size="sm"
                    onClick={() => setDeptOnly((v) => !v)}
                  >
                    {deptOnly ? "Show all departments" : `Show ${focusedDept.name} only`}
                  </Button>
                </span>
              )}
              <span
                className={focusedDept ? "w-full" : "ml-auto"}
                style={{ color: "var(--text-tertiary)" }}
              >
                {tab === "pending"
                  ? "The number in a cell counts everyone off that day, approved and requested"
                  : "The number in a cell is how many people are off that day"}
              </span>
            </div>
          </div>
        </Card>
        </div>
      </div>

      {/* Submit Leave Modal */}
      <Toast message={toast} />

      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="ta-modal max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl">
            <div
              className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-4"
              style={{
                background: "var(--surface-card)",
                borderBottom: "1px solid var(--stroke-divider)",
              }}
            >
              <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
                Submit Leave for Employee
              </h2>
              <Button hierarchy="tertiary" size="sm" iconOnly aria-label="Close" onClick={closeModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {submitSuccess ? (
              <div className="flex flex-col gap-4 px-6 py-5">
                <Banner
                  tone="success"
                  title="Leave request submitted"
                  body="It is now in the HR Review queue."
                />
                <div className="flex justify-end">
                  <Button onClick={closeModal}>Close</Button>
                </div>
              </div>
            ) : loadingTeam ? (
              <p
                className="px-6 py-8 text-center"
                style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}
              >
                Loading team members…
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
                <Field label="Employee">
                  <Select
                    value={targetEmployeeId}
                    onChange={(e) => handleEmployeeChange(e.target.value)}
                    required
                    style={{ width: "100%" }}
                  >
                    <option value="">Select employee…</option>
                    {teamEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.user?.name ?? emp.wmsId ?? emp.id}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Leave Type">
                  <Select
                    value={leaveTypeId}
                    onChange={(e) => setLeaveTypeId(e.target.value)}
                    required
                    style={{ width: "100%" }}
                  >
                    <option value="">Select type…</option>
                    {leaveTypes.map((lt) => (
                      <option key={lt.id} value={lt.id}>{lt.name}</option>
                    ))}
                  </Select>
                </Field>

                {/* Day picker — same as My Leave */}
                <FieldGroup label="Select Days">
                  <div
                    className="rounded-lg p-3"
                    style={{ border: "1px solid var(--stroke-secondary)" }}
                  >
                    <LeaveDayPicker value={selectedDays} onChange={setSelectedDays} shift={shift} />
                  </div>
                </FieldGroup>

                <Textarea
                  label="Note"
                  hint="Optional — visible to the employee"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Reason or additional context…"
                />

                {submitError && <Banner tone="error" body={submitError} />}

                <div className="flex justify-end gap-2">
                  <Button hierarchy="tertiary" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isPending || !targetEmployeeId || !leaveTypeId || selectedDays.length === 0}
                  >
                    {isPending ? "Submitting…" : "Submit Request"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div
          style={{ position: "fixed", top: tooltip.top, left: tooltip.left, zIndex: 100 }}
          className="ta-modal pointer-events-none flex min-w-[9rem] max-w-[14rem] flex-col gap-2 rounded-xl p-3"
        >
          <p
            style={{
              margin: 0,
              font: "var(--type-overline)",
              color: "var(--text-tertiary)",
            }}
          >
            {format(tooltip.date, "EEEE, MMM d")}
          </p>
          {tooltip.approved.length > 0 && (
            <TooltipGroup label="Approved" color="var(--text-success)" entries={tooltip.approved} />
          )}
          {tooltip.pending.length > 0 && (
            <TooltipGroup
              label={tooltip.hasConflict ? "Pending — overlaps approved leave" : "Pending"}
              color={tooltip.hasConflict ? "var(--text-error)" : "var(--text-warning)"}
              entries={tooltip.pending}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** A labelled control, in the stack the design system's own fields use. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

/**
 * The same stack around something that is not one control.
 *
 * <p>The day picker is a month of buttons with hidden inputs behind them, and
 * a <label> wrapping that does real damage: a click on the padding around the
 * grid gets forwarded to the first labelable descendant, so tapping empty
 * space inside the box would toggle a day nobody chose.
 */
function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1.5" role="group" aria-label={label}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>{children}</span>
  );
}

/** One key in the calendar legend. */
function Swatch({ label, bg, line }: { label: string; bg: string; line: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        style={{ width: 12, height: 12, borderRadius: 3, background: bg, border: `1px solid ${line}` }}
      />
      {label}
    </span>
  );
}

function TooltipGroup({
  label,
  color,
  entries,
}: {
  label: string;
  color: string;
  entries: { name: string; leaveType: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <span style={{ font: "var(--type-button2)", color }}>{label}</span>
      {entries.map((e, i) => (
        <div key={i} className="flex flex-col">
          <span style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}>{e.name}</span>
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            {e.leaveType}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Initials for the avatar. One word names give one letter, not a crash. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Oldest first, by when it was filed.
 *
 * <p>Falling back to the start date matters: a request created for somebody
 * else has no submittedAt, and sorting those to the top of the queue would put
 * the ones nobody has waited on above the ones people have.
 */
function byAge(a: LeaveRequestRow, b: LeaveRequestRow) {
  const aDate = a.submittedAt ? new Date(a.submittedAt).getTime() : new Date(a.startDate).getTime();
  const bDate = b.submittedAt ? new Date(b.submittedAt).getTime() : new Date(b.startDate).getTime();
  return aDate - bDate;
}

/**
 * The Approved queue arrives in the order the server chose, which is by start
 * date, and that is the order somebody scanning upcoming leave wants. The two
 * decision queues are oldest first, because those are waiting on a person.
 */
function sortForTab(
  items: { req: LeaveRequestRow; queue: Queue }[],
  tab: Tab,
): { req: LeaveRequestRow; queue: Queue }[] {
  if (tab === "upcoming") return items;
  return [...items].sort((a, b) => byAge(a.req, b.req));
}

/**
 * One request as a card, in the shape the design lays out: who, what and when,
 * how it collides with the rest of the team, then the actions for the queue it
 * is sitting in.
 *
 * <p>The actions are the same components the divided list used, so approving
 * from here runs exactly what approving ran before, including the note the
 * reject path requires.
 */
function RequestCard({
  req,
  queue,
  canHrApprove,
  conflictWith,
  selected,
  onSelect,
}: {
  req: LeaveRequestRow;
  queue: Queue;
  canHrApprove: boolean;
  conflictWith?: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  const start = parseLeaveDate(req.startDate);
  const end = parseLeaveDate(req.endDate);
  const days = differenceInCalendarDays(end, start) + 1;
  const status = req.status as LeaveRequestStatusValue;
  const clashes = conflictWith ?? [];
  const name = req.employee.user?.name ?? `Employee ${req.employeeId}`;
  const sameDay = differenceInCalendarDays(end, start) === 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="flex cursor-pointer items-start gap-3 px-4 py-3.5"
      style={{
        border: `1px solid ${selected ? "var(--stroke-accent)" : "var(--stroke-secondary)"}`,
        borderRadius: 10,
        background: selected ? "var(--surface-info)" : "var(--surface-card)",
        transition: "border-color 140ms ease, background 140ms ease",
      }}
    >
      <span
        aria-hidden="true"
        className="flex flex-none items-center justify-center"
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          background: selected ? "var(--fill-accent)" : "var(--surface-tertiary)",
          color: selected ? "#fff" : "var(--text-secondary)",
          font: "var(--weight-semibold) 13px/1 var(--font-sans)",
        }}
      >
        {initialsOf(name)}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2.5">
          <span
            className="min-w-0 flex-1 truncate"
            style={{ font: "var(--weight-semibold) 15px/21px var(--font-sans)", color: "var(--text-primary)" }}
          >
            {name}
          </span>
          <span className="flex-none">
            <Badge tone={leaveTone(status)} size="sm">
              {LEAVE_STATUS_LABEL[status] ?? status}
            </Badge>
          </span>
        </div>

        <span style={{ font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
          {req.leaveType.name}
          {" \u00b7 "}
          {sameDay
            ? format(start, "MMM d, yyyy")
            : `${format(start, "MMM d")} \u2013 ${format(end, "MMM d, yyyy")}`}
        </span>

        <span
          className="tabular"
          style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
        >
          {(req.durationMinutes / 60).toFixed(2)} h {"\u00b7"} {days} day{days === 1 ? "" : "s"}
          {req.submittedAt ? ` \u00b7 Filed ${format(new Date(req.submittedAt), "MMM d")}` : ""}
        </span>

        {/* The overlap line is the reason this screen exists. It names people
            rather than only reporting that a clash exists, because "who" was
            always the next question. */}
        <span
          className="flex items-start gap-1.5"
          style={{
            font: "var(--type-body2)",
            fontWeight: "var(--weight-medium)",
            color: clashes.length > 0 ? "var(--text-warning)" : "var(--text-secondary)",
            textWrap: "pretty",
          }}
        >
          {clashes.length > 0 && (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          )}
          {clashes.length > 0
            ? `Overlaps approved leave for ${clashes.join(", ")}`
            : "Nobody else on the team is off then"}
        </span>

        {req.note && (
          <span style={{ font: "var(--type-body2)", color: "var(--text-primary)", textWrap: "pretty" }}>
            &ldquo;{req.note}&rdquo;
          </span>
        )}

        {/* Clicking an action must not also toggle the card selection. */}
        <div
          className="mt-2 flex flex-wrap items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {queue === "pending" && <LeaveApprovalButtons leaveRequestId={req.id} />}
          {queue === "hr-pending" &&
            (canHrApprove ? (
              <HrApproveButtons leaveRequestId={req.id} />
            ) : (
              <LeaveReverseButton leaveRequestId={req.id} label="Return to Supervisor Queue" />
            ))}
          {queue === "upcoming" && req.status === "APPROVED" && (
            <LeaveReverseButton leaveRequestId={req.id} />
          )}
        </div>
      </div>
    </div>
  );
}
