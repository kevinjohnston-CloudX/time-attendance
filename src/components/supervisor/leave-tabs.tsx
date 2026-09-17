"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO, differenceInCalendarDays, eachDayOfInterval, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, isToday } from "date-fns";

// @db.Date fields arrive from the server as ISO strings at UTC midnight.
// Extract YYYY-MM-DD and parseISO to get local midnight — avoids timezone day shift.
function parseLeaveDate(d: Date | string): Date {
  const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  return parseISO(s);
}
import { ChevronLeft, ChevronRight, X, Plus } from "lucide-react";
import { LeaveApprovalButtons } from "@/components/supervisor/leave-approval-buttons";
import { LeaveReverseButton } from "@/components/supervisor/leave-reverse-button";
import { HrApproveButtons } from "@/components/supervisor/hr-approve-buttons";
import { LEAVE_STATUS_LABEL, LEAVE_STATUS_BADGE, type LeaveRequestStatusValue } from "@/lib/state-machines/labels";
import { getTeamMembersForLeave, createLeaveRequestForEmployee } from "@/actions/leave.actions";
import { LeaveDayPicker, type DaySelection, type ShiftInfo } from "@/components/leave/leave-day-picker";

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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function LeaveTabs({ pending, hrPending, upcoming, initialTab, canFilter, canHrApprove, canSubmitLeave, sites = [], departments = [], selectedSiteId, selectedDepartmentId }: LeaveTabsProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "hr-pending" | "upcoming">(initialTab ?? "pending");
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

  function navigate(siteId?: string, departmentId?: string) {
    const params = new URLSearchParams();
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    params.set("tab", tab);
    router.push(`/supervisor/leave?${params.toString()}`);
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

  // Which pending requests overlap with approved leave from a different employee
  const conflictIds = new Set<string>();
  for (const req of pending) {
    const days = eachDayOfInterval({ start: parseLeaveDate(req.startDate), end: parseLeaveDate(req.endDate) });
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      const approved = approvedMap.get(key) ?? [];
      if (approved.some((a) => a.employeeId !== req.employeeId)) {
        conflictIds.add(req.id);
        break;
      }
    }
  }

  // Calendar grid spanning full weeks of the visible month
  const gridDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(calMonth)),
    end: endOfWeek(endOfMonth(calMonth)),
  });

  const btnBase = "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition";
  const btnActive = "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white";
  const btnInactive = "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200";

  return (
    <div className="flex -mx-6 -my-8 h-screen">
      {/* ── Left panel: list ─────────────────────────── */}
      <div className="w-80 shrink-0 border-r border-zinc-200 dark:border-zinc-800 h-full overflow-y-auto flex flex-col">
        <div className="px-4 pt-6 pb-3">
          <a
            href="/supervisor"
            className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            ← Team Portal
          </a>
          <div className="mt-1 flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Team Leave</h1>
            {canSubmitLeave && (
              <button
                type="button"
                onClick={openSubmitModal}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Submit Leave
              </button>
            )}
          </div>
        </div>

        {/* Site / Department filter — payroll+ only */}
        {canFilter && (
          <div className="flex flex-col gap-2 px-4 pb-3">
            {sites.length > 0 && (
              <select
                value={selectedSiteId ?? ""}
                onChange={(e) => navigate(e.target.value || undefined, undefined)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              >
                <option value="">All Sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <select
              value={selectedDepartmentId ?? ""}
              onChange={(e) => navigate(selectedSiteId, e.target.value || undefined)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {(selectedSiteId || selectedDepartmentId) && (
              <button
                type="button"
                onClick={() => navigate()}
                className="self-start text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Tab toggle */}
        <div className="px-4 pb-3">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            <button
              onClick={() => setTab("pending")}
              className={`${btnBase} ${tab === "pending" ? btnActive : btnInactive}`}
            >
              Pending ({pending.length})
            </button>
            <button
              onClick={() => setTab("hr-pending")}
              className={`${btnBase} relative ${tab === "hr-pending" ? btnActive : btnInactive}`}
            >
              HR Review
              {hrPending.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold text-white">
                  {hrPending.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab("upcoming")}
              className={`${btnBase} ${tab === "upcoming" ? btnActive : btnInactive}`}
            >
              Upcoming ({upcoming.length})
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-6 flex flex-col gap-3">
          {tab === "pending" && <PendingList requests={pending} conflictIds={conflictIds} />}
          {tab === "hr-pending" && <HrPendingList requests={hrPending} canHrApprove={!!canHrApprove} />}
          {tab === "upcoming" && <UpcomingList requests={upcoming} />}
        </div>
      </div>

      {/* ── Right panel: calendar ─────────────────────── */}
      <div className="flex-1 overflow-y-auto h-full p-6">
        {/* Month navigation */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCalMonth((m) => subMonths(m, 1))}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9rem] text-center text-base font-semibold text-zinc-900 dark:text-white">
              {format(calMonth, "MMMM yyyy")}
            </span>
            <button
              onClick={() => setCalMonth((m) => addMonths(m, 1))}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setCalMonth(new Date())}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            Current Month
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="mb-2 grid grid-cols-7 rounded-lg bg-zinc-800 dark:bg-zinc-600">
          {WEEKDAYS.map((d, i) => (
            <div
              key={d}
              className={`py-2 text-center text-xs font-semibold uppercase tracking-wide ${
                i === 0 || i === 6 ? "text-zinc-400 dark:text-zinc-300" : "text-zinc-100 dark:text-white"
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
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

            const hasPending = pendingEntries.length > 0;
            const hasApproved = approvedEntries.length > 0;
            const hasAny = hasPending || hasApproved;

            let bgClass = "bg-zinc-50 border-zinc-200 dark:bg-zinc-800/50 dark:border-zinc-700";
            if (hasPending && hasConflict) bgClass = "bg-red-50 border-transparent dark:bg-red-950/30 dark:border-transparent";
            else if (hasPending) bgClass = "bg-amber-50 border-transparent dark:bg-amber-950/30 dark:border-transparent";
            else if (hasApproved) bgClass = "bg-green-50 border-transparent dark:bg-green-950/30 dark:border-transparent";

            let dateNumColor = inMonth ? "text-zinc-900 dark:text-white" : "text-zinc-300 dark:text-zinc-600";
            if (inMonth && !todayDay) {
              if (hasPending && hasConflict) dateNumColor = "text-red-700 dark:text-red-400";
              else if (hasPending) dateNumColor = "text-amber-700 dark:text-amber-400";
              else if (hasApproved) dateNumColor = "text-green-800 dark:text-green-300";
            }

            return (
              <div
                key={key}
                className={`relative flex min-h-[4.5rem] flex-col rounded-lg border p-2 font-medium transition-colors ${bgClass}`}
                onMouseEnter={
                  hasAny
                    ? (e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({
                          top: rect.bottom + 6,
                          left: Math.min(rect.left, window.innerWidth - 220),
                          approved: approvedEntries.map((e) => ({ name: e.name, leaveType: e.leaveType })),
                          pending: pendingEntries.map((e) => ({ name: e.name, leaveType: e.leaveType })),
                          hasConflict,
                          date: day,
                        });
                      }
                    : undefined
                }
                onMouseLeave={() => setTooltip(null)}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium ${
                    todayDay ? "bg-blue-600 text-white" : dateNumColor
                  }`}
                >
                  {format(day, "d")}
                </span>

                <div className="mt-1 flex flex-col gap-0.5">
                  {hasApproved && approvedEntries.slice(0, 2).map((e, i) => (
                    <span key={`a${i}`} className="truncate rounded bg-green-200 px-1 text-xs text-green-800 dark:bg-green-900/60 dark:text-green-300">
                      {e.name.split(" ")[0]}
                    </span>
                  ))}
                  {hasApproved && approvedEntries.length > 2 && (
                    <span className="text-xs text-green-600 dark:text-green-400">+{approvedEntries.length - 2} more</span>
                  )}
                  {hasPending && pendingEntries.slice(0, 2).map((e, i) => (
                    <span key={`p${i}`} className={`truncate rounded px-1 text-xs ${
                      hasConflict
                        ? "bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-300"
                        : "bg-amber-200 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300"
                    }`}>
                      {e.name.split(" ")[0]}
                    </span>
                  ))}
                  {hasPending && pendingEntries.length > 2 && (
                    <span className={`text-xs ${hasConflict ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                      +{pendingEntries.length - 2} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-5 text-xs text-zinc-700 dark:text-zinc-300">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-green-400 dark:bg-green-600" />
            Approved Leave
          </span>
          {tab === "pending" && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-amber-400 dark:bg-amber-600" />
                Pending Leave
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-red-400 dark:bg-red-600" />
                Conflict (overlap with approved)
              </span>
            </>
          )}
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-blue-600" />
            Today
          </span>
        </div>
      </div>

      {/* Submit Leave Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-700 dark:bg-zinc-900">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Submit Leave for Employee</h2>
              <button type="button" onClick={closeModal} className="rounded-lg p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <X className="h-4 w-4" />
              </button>
            </div>

            {submitSuccess ? (
              <div className="px-6 py-8 text-center">
                <p className="text-sm font-medium text-green-600 dark:text-green-400">Leave request submitted successfully.</p>
                <p className="mt-1 text-xs text-zinc-400">It is now in the HR Review queue.</p>
                <button
                  type="button"
                  onClick={closeModal}
                  className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Close
                </button>
              </div>
            ) : loadingTeam ? (
              <div className="px-6 py-8 text-center text-sm text-zinc-400">Loading team members…</div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-5">
                {/* Employee selector */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Employee
                  </label>
                  <select
                    value={targetEmployeeId}
                    onChange={(e) => handleEmployeeChange(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    <option value="">Select employee…</option>
                    {teamEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.user?.name ?? emp.wmsId ?? emp.id}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Leave Type */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Leave Type
                  </label>
                  <select
                    value={leaveTypeId}
                    onChange={(e) => setLeaveTypeId(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    <option value="">Select type…</option>
                    {leaveTypes.map((lt) => (
                      <option key={lt.id} value={lt.id}>{lt.name}</option>
                    ))}
                  </select>
                </div>

                {/* Day picker — same as My Leave */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Select Days
                  </label>
                  <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                    <LeaveDayPicker value={selectedDays} onChange={setSelectedDays} shift={shift} />
                  </div>
                </div>

                {/* Note */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Note <span className="font-normal text-zinc-400">(optional)</span>
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Reason or additional context…"
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>

                {submitError && (
                  <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {submitError}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending || !targetEmployeeId || !leaveTypeId || selectedDays.length === 0}
                    className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {isPending ? "Submitting…" : "Submit Request"}
                  </button>
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
          className="pointer-events-none min-w-[9rem] max-w-[14rem] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {format(tooltip.date, "EEEE, MMM d")}
          </p>
          {tooltip.approved.length > 0 && (
            <div className="mb-1.5">
              <p className="mb-0.5 text-xs font-medium text-green-700 dark:text-green-400">Approved</p>
              {tooltip.approved.map((e, i) => (
                <div key={i} className={i > 0 ? "mt-1" : ""}>
                  <p className="text-sm text-zinc-900 dark:text-white">{e.name}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{e.leaveType}</p>
                </div>
              ))}
            </div>
          )}
          {tooltip.pending.length > 0 && (
            <div>
              <p className={`mb-0.5 text-xs font-medium ${tooltip.hasConflict ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                {tooltip.hasConflict ? "Pending (conflict)" : "Pending"}
              </p>
              {tooltip.pending.map((e, i) => (
                <div key={i} className={i > 0 ? "mt-1" : ""}>
                  <p className="text-sm text-zinc-900 dark:text-white">{e.name}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{e.leaveType}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PendingList({ requests, conflictIds }: { requests: LeaveRequestRow[]; conflictIds: Set<string> }) {
  if (requests.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">No pending leave requests.</p>
    );
  }

  const sorted = [...requests].sort((a, b) => {
    const aDate = a.submittedAt ? new Date(a.submittedAt).getTime() : new Date(a.startDate).getTime();
    const bDate = b.submittedAt ? new Date(b.submittedAt).getTime() : new Date(b.startDate).getTime();
    return aDate - bDate;
  });

  return (
    <>
      {sorted.map((req) => {
        const days =
          differenceInCalendarDays(parseLeaveDate(req.endDate), parseLeaveDate(req.startDate)) + 1;
        const hasConflict = conflictIds.has(req.id);

        return (
          <div
            key={req.id}
            className={`rounded-xl border p-4 ${
              hasConflict
                ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
                : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-zinc-900 dark:text-white">
                {req.employee.user?.name ?? `Employee ${req.employeeId}`}
              </p>
              {hasConflict && (
                <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
                  Overlap
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-zinc-500">
              {req.leaveType.name} &middot;{" "}
              {format(parseLeaveDate(req.startDate), "MMM d")} &ndash;{" "}
              {format(parseLeaveDate(req.endDate), "MMM d, yyyy")} ({days} day
              {days !== 1 ? "s" : ""})
            </p>
            {req.note && (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                &ldquo;{req.note}&rdquo;
              </p>
            )}
            {req.submittedAt && (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                Submitted {format(new Date(req.submittedAt), "MMM d, yyyy 'at' h:mm a")}
              </p>
            )}
            <div className="mt-3">
              <LeaveApprovalButtons leaveRequestId={req.id} />
            </div>
          </div>
        );
      })}
    </>
  );
}

function HrPendingList({ requests, canHrApprove }: { requests: LeaveRequestRow[]; canHrApprove: boolean }) {
  if (requests.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">No leave requests awaiting HR review.</p>
    );
  }

  const sorted = [...requests].sort((a, b) => {
    const aDate = a.submittedAt ? new Date(a.submittedAt).getTime() : new Date(a.startDate).getTime();
    const bDate = b.submittedAt ? new Date(b.submittedAt).getTime() : new Date(b.startDate).getTime();
    return aDate - bDate;
  });

  return (
    <>
      {sorted.map((req) => {
        const days = differenceInCalendarDays(parseLeaveDate(req.endDate), parseLeaveDate(req.startDate)) + 1;
        const hours = (req.durationMinutes / 60).toFixed(1);

        return (
          <div
            key={req.id}
            className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-zinc-900 dark:text-white">
                {req.employee.user?.name ?? `Employee ${req.employeeId}`}
              </p>
              <span className="shrink-0 inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                Pending HR
              </span>
            </div>
            <p className="mt-0.5 text-sm text-zinc-500">
              {req.leaveType.name} &middot;{" "}
              {format(parseLeaveDate(req.startDate), "MMM d")} &ndash;{" "}
              {format(parseLeaveDate(req.endDate), "MMM d, yyyy")}
            </p>
            <p className="text-xs text-zinc-400">
              {days} day{days !== 1 ? "s" : ""} &middot; {hours}h
            </p>
            {req.note && (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">&ldquo;{req.note}&rdquo;</p>
            )}
            {canHrApprove
              ? <HrApproveButtons leaveRequestId={req.id} />
              : <LeaveReverseButton leaveRequestId={req.id} label="Return to Supervisor Queue" />
            }
          </div>
        );
      })}
    </>
  );
}

function UpcomingList({ requests }: { requests: LeaveRequestRow[] }) {
  if (requests.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">No upcoming approved leave.</p>
    );
  }

  return (
    <>
      {requests.map((req) => {
        const days =
          differenceInCalendarDays(parseLeaveDate(req.endDate), parseLeaveDate(req.startDate)) + 1;
        const hours = (req.durationMinutes / 60).toFixed(1);
        const status = req.status as LeaveRequestStatusValue;

        return (
          <div
            key={req.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-zinc-900 dark:text-white">
                  {req.employee.user?.name ?? `Employee ${req.employeeId}`}
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {req.leaveType.name} &middot;{" "}
                  {format(parseLeaveDate(req.startDate), "MMM d")} &ndash;{" "}
                  {format(parseLeaveDate(req.endDate), "MMM d, yyyy")}
                </p>
                <p className="text-xs text-zinc-400">
                  {days} day{days !== 1 ? "s" : ""} &middot; {hours}h
                </p>
              </div>
              <span
                className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  LEAVE_STATUS_BADGE[status] ?? ""
                }`}
              >
                {LEAVE_STATUS_LABEL[status] ?? status}
              </span>
            </div>
            {status === "APPROVED" && (
              <LeaveReverseButton leaveRequestId={req.id} />
            )}
          </div>
        );
      })}
    </>
  );
}
