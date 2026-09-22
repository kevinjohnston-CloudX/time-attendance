"use client";

import { useState, useTransition, type ReactNode } from "react";
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
  FilterBar,
  FilterChip,
  LinkButton,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  Textarea,
  Toolbar,
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
  employee: { user: { name: string | null } | null };
  leaveType: { name: string };
}

/** Which queue a row came from. The All view mixes all three. */
type Queue = "pending" | "hr-pending" | "upcoming";

interface LeaveTabsProps {
  pending: LeaveRequestRow[];
  hrPending: LeaveRequestRow[];
  upcoming: LeaveRequestRow[];
  initialTab?: "pending" | "hr-pending" | "upcoming";
  canFilter?: boolean;
  canHrApprove?: boolean;
  canSubmitLeave?: boolean;
  sites?: { id: string; name: string }[];
  departments?: { id: string; name: string }[];
  selectedSiteId?: string;
  selectedDepartmentId?: string;
}

type Tab = "all" | "pending" | "hr-pending" | "upcoming";

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
  initialTab,
  canFilter,
  canHrApprove,
  canSubmitLeave,
  sites = [],
  departments = [],
  selectedSiteId,
  selectedDepartmentId,
}: LeaveTabsProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab ?? "pending");
  // Name search is the design's addition. It filters rows already fetched, so
  // it never re-queries and never widens what this person is allowed to see.
  const [query, setQuery] = useState("");
  // Which card is expanded in the coverage panel. The design selects a request
  // and shows its days on the calendar.
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  function hrefFor(next: { siteId?: string; departmentId?: string }) {
    const params = new URLSearchParams();
    if (next.siteId) params.set("siteId", next.siteId);
    if (next.departmentId) params.set("departmentId", next.departmentId);
    params.set("tab", tab);
    return `/supervisor/leave?${params.toString()}`;
  }

  function navigate(siteId?: string, departmentId?: string) {
    router.push(hrefFor({ siteId, departmentId }));
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
  type Entry = { name: string; employeeId: string; leaveType: string };
  const approvedMap = new Map<string, Entry[]>();
  for (const req of upcoming) {
    const days = eachDayOfInterval({ start: parseLeaveDate(req.startDate), end: parseLeaveDate(req.endDate) });
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      if (!approvedMap.has(key)) approvedMap.set(key, []);
      approvedMap.get(key)!.push({ name: req.employee.user?.name ?? "Unknown", employeeId: req.employeeId, leaveType: req.leaveType.name });
    }
  }

  const pendingMap = new Map<string, Entry[]>();
  for (const req of pending) {
    const days = eachDayOfInterval({ start: parseLeaveDate(req.startDate), end: parseLeaveDate(req.endDate) });
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      if (!pendingMap.has(key)) pendingMap.set(key, []);
      pendingMap.get(key)!.push({ name: req.employee.user?.name ?? "Unknown", employeeId: req.employeeId, leaveType: req.leaveType.name });
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
  // The page only passes siteId/departmentId into the three queries when
  // canFilter is true, so a ?siteId= left in the URL by somebody without that
  // permission narrows nothing. A chip for it would claim a filter the rows
  // underneath were never filtered by, and would turn a genuinely empty queue
  // into "nothing matches your filters".
  const isFiltered = !!(canFilter && (selectedSiteId || selectedDepartmentId));

  const siteName = sites.find((s) => s.id === selectedSiteId)?.name ?? selectedSiteId;
  const deptName = departments.find((d) => d.id === selectedDepartmentId)?.name ?? selectedDepartmentId;

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
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Team Leave"
        subtitle={`${pending.length} awaiting you · ${hrPending.length} with HR · ${upcoming.length} approved upcoming`}
        actions={
          <>
            <LinkButton href="/supervisor" hierarchy="tertiary">
              ← Team Portal
            </LinkButton>
            {canSubmitLeave && (
              <Button onClick={openSubmitModal} leadingIcon={<Plus className="h-4 w-4" />}>
                Submit Leave
              </Button>
            )}
          </>
        }
      />

      <Toolbar count={rows.length} countLabel="request">
        {/* Stays a SegmentedControl rather than the URL-backed SegmentedLinks:
            each tab is a separate permission-scoped query that the server has
            already run, so switching is a filter over rows in hand, not a
            re-fetch. The ?tab= parameter still picks the opening tab, which is
            what the dashboard's "Team Calendar" link relies on. */}
        <SegmentedControl
          ariaLabel="Leave view"
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
          }}
        />

        {/* Name search, from the design. Filters rows already on the page. */}
        <SearchInput
          aria-label="Search by employee name"
          placeholder="Employee name"
          value={query}
          onValueChange={setQuery}
        />

        {/* Site / Department filter — payroll+ only */}
        {canFilter && sites.length > 0 && (
          <Select
            aria-label="Site"
            value={selectedSiteId ?? ""}
            onChange={(e) => navigate(e.target.value || undefined, undefined)}
          >
            <option value="">All Sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        )}
        {canFilter && (
          <Select
            aria-label="Department"
            value={selectedDepartmentId ?? ""}
            onChange={(e) => navigate(selectedSiteId, e.target.value || undefined)}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        )}
      </Toolbar>

      <FilterBar clearHref={isFiltered ? hrefFor({}) : undefined}>
        {/* Clearing the site clears the department with it. The department list
            the server offers is scoped to the chosen site, so a department left
            behind would be filtering by something no longer on screen. */}
        {canFilter && selectedSiteId ? (
          <FilterChip label="Site" value={siteName} clearHref={hrefFor({})} />
        ) : null}
        {canFilter && selectedDepartmentId ? (
          <FilterChip
            label="Department"
            value={deptName}
            clearHref={hrefFor({ siteId: selectedSiteId })}
          />
        ) : null}
      </FilterBar>

      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(360px,42%)),1fr))]">
        {/* ── The requests ─────────────────────────────────────────────── */}
        {/* The list is a stack of selectable cards, as the design lays it
            out, rather than one card of divided rows. Selecting a card drives
            the coverage panel beside it. */}
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>
              {LIST_CARD[tab].title}
            </span>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              {LIST_CARD[tab].subtitle}
            </span>
          </div>

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
            sortForTab(visible, tab).map(({ req, queue }) => (
              <RequestCard
                key={req.id}
                req={req}
                queue={queue}
                canHrApprove={!!canHrApprove}
                conflictWith={conflictNames.get(req.id)}
                selected={req.id === selectedId}
                onSelect={() => setSelectedId(req.id === selectedId ? null : req.id)}
              />
            ))
          )}
        </div>

        {/* ── Coverage ─────────────────────────────────────────────────── */}
        <Card
          title="Coverage"
          subtitle={
            tab === "pending"
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
                const approvedEntries = approvedMap.get(key) ?? [];
                const pendingEntries = tab === "pending" ? (pendingMap.get(key) ?? []) : [];
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
                      border: `1px solid ${tone ? tone.line : "var(--stroke-secondary)"}`,
                      background: tone ? tone.bg : inMonth ? "var(--surface-card)" : "transparent",
                      // Out-of-month days are dimmed rather than hidden: a
                      // request that runs over a month boundary has to stay
                      // visible on both sides of it.
                      opacity: inMonth ? 1 : total > 0 ? 0.6 : 0.4,
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
              <span className="ml-auto" style={{ color: "var(--text-tertiary)" }}>
                {tab === "pending"
                  ? "The number in a cell counts everyone off that day, approved and requested"
                  : "The number in a cell is how many people are off that day"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Submit Leave Modal */}
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
        background: selected ? "var(--wms-color-primary-50)" : "var(--surface-card)",
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
