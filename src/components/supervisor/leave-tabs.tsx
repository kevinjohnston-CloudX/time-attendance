"use client";

import { useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { LeaveApprovalButtons } from "@/components/supervisor/leave-approval-buttons";
import {
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_BADGE,
  type LeaveRequestStatusValue,
} from "@/lib/state-machines/labels";

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
}

type Tab = "pending" | "upcoming";

export function LeaveTabs({ pending, upcoming }: LeaveTabsProps) {
  const [tab, setTab] = useState<Tab>("pending");

  return (
    <div>
      {/* Tab bar */}
      <div className="mt-4 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        <button
          onClick={() => setTab("pending")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            tab === "pending"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Pending ({pending.length})
        </button>
        <button
          onClick={() => setTab("upcoming")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            tab === "upcoming"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Upcoming ({upcoming.length})
        </button>
      </div>

      {/* Tab content */}
      <div className="mt-4 flex flex-col gap-3">
        {tab === "pending" && <PendingList requests={pending} />}
        {tab === "upcoming" && <UpcomingList requests={upcoming} />}
      </div>
    </div>
  );
}

function PendingList({ requests }: { requests: LeaveRequestRow[] }) {
  if (requests.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No pending leave requests.
      </p>
    );
  }

  return (
    <>
      {requests.map((req) => {
        const days =
          differenceInCalendarDays(new Date(req.endDate), new Date(req.startDate)) + 1;

        return (
          <div
            key={req.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-zinc-900 dark:text-white">
                  {req.employee.user?.name ?? `Employee ${req.employeeId}`}
                </p>
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
              </div>
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
      <p className="py-8 text-center text-sm text-zinc-400">
        No upcoming approved leave.
      </p>
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-zinc-900 dark:text-white">
                  {req.employee.user?.name ?? `Employee ${req.employeeId}`}
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {req.leaveType.name} &middot;{" "}
                  {format(new Date(req.startDate), "MMM d")} &ndash;{" "}
                  {format(new Date(req.endDate), "MMM d, yyyy")} ({days} day
                  {days !== 1 ? "s" : ""}, {hours}h)
                </p>
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
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
