"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { formatMinutes } from "@/lib/utils/duration";
import { TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/labels";

const TS_BADGE: Record<string, string> = {
  OPEN:             "bg-zinc-100 text-zinc-600",
  SUBMITTED:        "bg-blue-100 text-blue-700",
  SUP_APPROVED:     "bg-purple-100 text-purple-700",
  PAYROLL_APPROVED: "bg-green-100 text-green-700",
  LOCKED:           "bg-zinc-200 text-zinc-500",
};

export type TimesheetTile = {
  id: string;
  employeeId: string;
  employeeName: string;
  status: string;
  reg: number;
  ot: number;
  dt: number;
  hasExceptions: boolean;
  issues: string[];
  siteId: string | null;
  siteName: string | null;
};

function TimesheetCard({
  ts,
  payPeriodId,
  expanded,
  onToggle,
}: {
  ts: TimesheetTile;
  payPeriodId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isApproved = ts.status === "PAYROLL_APPROVED" || ts.status === "LOCKED";
  const hasIssues = ts.issues.length > 0;

  return (
    <div
      className={`rounded-xl border bg-white dark:bg-zinc-900 overflow-hidden ${
        hasIssues
          ? "border-red-300 dark:border-red-800/60"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-center justify-between p-4">
        <Link
          href={`/payroll/timecards?payPeriodId=${payPeriodId}&employeeId=${ts.employeeId}`}
          className="flex flex-1 min-w-0 items-center gap-3 transition-opacity hover:opacity-80"
        >
          {isApproved && !ts.hasExceptions ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
          ) : ts.hasExceptions ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          ) : (
            <Clock className="h-4 w-4 shrink-0 text-zinc-400" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-zinc-900 dark:text-white truncate">
              {ts.employeeName}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              REG {formatMinutes(ts.reg)}
              {ts.ot > 0 && (
                <span className="ml-2 text-amber-600">OT {formatMinutes(ts.ot)}</span>
              )}
              {ts.dt > 0 && (
                <span className="ml-2 text-red-600">DT {formatMinutes(ts.dt)}</span>
              )}
            </p>
          </div>
        </Link>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${TS_BADGE[ts.status] ?? ""}`}>
            {TIMESHEET_STATUS_LABEL[ts.status]}
          </span>
          {hasIssues && (
            <button
              onClick={onToggle}
              className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
            >
              {ts.issues.length} issue{ts.issues.length !== 1 ? "s" : ""}
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>

      {hasIssues && expanded && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-900/10">
          <ul className="flex flex-col gap-1.5">
            {ts.issues.map((issue, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PayPeriodTimesheets({
  timesheets,
  payPeriodId,
}: {
  timesheets: TimesheetTile[];
  payPeriodId: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (timesheets.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-zinc-400">
        No timesheets for this pay period.
      </p>
    );
  }

  // Group by site
  const groupMap = new Map<string, { siteName: string; sheets: TimesheetTile[] }>();
  for (const ts of timesheets) {
    const key = ts.siteId ?? "__none__";
    const label = ts.siteName ?? "No Site";
    if (!groupMap.has(key)) groupMap.set(key, { siteName: label, sheets: [] });
    groupMap.get(key)!.sheets.push(ts);
  }
  const groups = Array.from(groupMap.values()).sort((a, b) =>
    a.siteName.localeCompare(b.siteName)
  );
  const showHeaders =
    groups.length > 1 || (groups.length === 1 && groups[0].siteName !== "No Site");

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.siteName}>
          {showHeaders && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {group.siteName}
            </h3>
          )}
          <div className="flex flex-col gap-2">
            {group.sheets.map((ts) => (
              <TimesheetCard
                key={ts.id}
                ts={ts}
                payPeriodId={payPeriodId}
                expanded={expanded.has(ts.id)}
                onToggle={() => toggle(ts.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
