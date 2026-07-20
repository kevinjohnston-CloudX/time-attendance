"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, differenceInCalendarDays, eachDayOfInterval, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LeaveApprovalButtons } from "@/components/supervisor/leave-approval-buttons";
import { LEAVE_STATUS_LABEL, LEAVE_STATUS_BADGE, type LeaveRequestStatusValue } from "@/lib/state-machines/labels";

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
  upcoming: LeaveRequestRow[];
  initialTab?: "pending" | "upcoming";
  canFilter?: boolean;
  sites?: { id: string; name: string }[];
  departments?: { id: string; name: string }[];
  selectedSiteId?: string;
  selectedDepartmentId?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function LeaveTabs({ pending, upcoming, initialTab, canFilter, sites = [], departments = [], selectedSiteId, selectedDepartmentId }: LeaveTabsProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "upcoming">(initialTab ?? "pending");

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
    approved: string[];
    pending: string[];
    hasConflict: boolean;
    date: Date;
  } | null>(null);

  // Build date → { name, employeeId } maps
  type Entry = { name: string; employeeId: string };
  const approvedMap = new Map<string, Entry[]>();
  for (const req of upcoming) {
    const days = eachDayOfInterval({ start: new Date(req.startDate), end: new Date(req.endDate) });
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      if (!approvedMap.has(key)) approvedMap.set(key, []);
      approvedMap.get(key)!.push({ name: req.employee.user?.name ?? "Unknown", employeeId: req.employeeId });
    }
  }

  const pendingMap = new Map<string, Entry[]>();
  for (const req of pending) {
    const days = eachDayOfInterval({ start: new Date(req.startDate), end: new Date(req.endDate) });
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      if (!pendingMap.has(key)) pendingMap.set(key, []);
      pendingMap.get(key)!.push({ name: req.employee.user?.name ?? "Unknown", employeeId: req.employeeId });
    }
  }

  // Which pending requests overlap with approved leave from a different employee
  const conflictIds = new Set<string>();
  for (const req of pending) {
    const days = eachDayOfInterval({ start: new Date(req.startDate), end: new Date(req.endDate) });
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
          <h1 className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">Team Leave</h1>
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

        {/* Pending / Upcoming toggle */}
        <div className="px-4 pb-3">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            <button
              onClick={() => setTab("pending")}
              className={`${btnBase} ${tab === "pending" ? btnActive : btnInactive}`}
            >
              Pending ({pending.length})
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
                          approved: approvedEntries.map((e) => e.name),
                          pending: pendingEntries.map((e) => e.name),
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
              {tooltip.approved.map((name, i) => (
                <p key={i} className="text-sm text-zinc-900 dark:text-white">{name}</p>
              ))}
            </div>
          )}
          {tooltip.pending.length > 0 && (
            <div>
              <p className={`mb-0.5 text-xs font-medium ${tooltip.hasConflict ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                {tooltip.hasConflict ? "Pending (conflict)" : "Pending"}
              </p>
              {tooltip.pending.map((name, i) => (
                <p key={i} className="text-sm text-zinc-900 dark:text-white">{name}</p>
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
          differenceInCalendarDays(new Date(req.endDate), new Date(req.startDate)) + 1;
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
              {format(new Date(req.startDate), "MMM d")} &ndash;{" "}
              {format(new Date(req.endDate), "MMM d, yyyy")} ({days} day
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
          differenceInCalendarDays(new Date(req.endDate), new Date(req.startDate)) + 1;
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
                  {format(new Date(req.startDate), "MMM d")} &ndash;{" "}
                  {format(new Date(req.endDate), "MMM d, yyyy")}
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
          </div>
        );
      })}
    </>
  );
}
