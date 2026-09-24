"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import { TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/labels";
import { Badge, EmptyState, SearchInput, statusTone } from "@/components/ui";

/**
 * Every timesheet in the pay period, grouped by site.
 *
 * <p>Each row reads left to right as one sentence: who, their hours, where
 * the timesheet sits, and whose move it is. What blocks the close is said in
 * words on the row itself (a tinted exceptions count, "Waiting on the
 * supervisor") rather than behind a disclosure, so a clean period and a
 * blocked one look different at a glance.
 *
 * <p>The name opens the person's timecard on this period. Search narrows the
 * rows already here, as you type; site, department and Show are in the link.
 */

export type TimesheetRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  status: string;
  reg: number;
  ot: number;
  dt: number;
  exceptions: number;
  siteId: string | null;
  siteName: string | null;
};

/** Whose move it is, the same words the Approvals list uses. */
const WAITING_ON: Record<string, string> = {
  OPEN: "Waiting on the employee",
  REJECTED: "Sent back to the employee",
  SUBMITTED: "Waiting on the supervisor",
  SUP_APPROVED: "Waiting on payroll",
  PAYROLL_APPROVED: "Ready to lock",
  LOCKED: "Closed",
};

const COLUMNS = "minmax(180px, 1.5fr) 84px 84px 84px minmax(130px, 0.7fr) minmax(270px, 1.6fr) 20px";

function hours(minutes: number): string {
  return (minutes / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PayPeriodTimesheets({
  timesheets,
  payPeriodId,
  filtered = false,
  filters,
}: {
  timesheets: TimesheetRow[];
  payPeriodId: string;
  /** Whether a site, department or Show filter is narrowing the list. */
  filtered?: boolean;
  /** The site, department and Show pills, drawn beside the search. */
  filters?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q ? timesheets.filter((t) => t.employeeName.toLowerCase().includes(q)) : timesheets;

  // Group by site, sites in name order.
  const groupMap = new Map<string, { siteName: string; sheets: TimesheetRow[] }>();
  for (const ts of visible) {
    const key = ts.siteId ?? "__none__";
    if (!groupMap.has(key)) groupMap.set(key, { siteName: ts.siteName ?? "No site", sheets: [] });
    groupMap.get(key)!.sheets.push(ts);
  }
  const groups = [...groupMap.values()].sort((a, b) => a.siteName.localeCompare(b.siteName));
  for (const g of groups) g.sheets.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const showHeaders = groups.length > 1 || (groups.length === 1 && groups[0].siteName !== "No site");

  return (
    <div className="flex flex-col">
      <div
        className="flex flex-wrap items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: "1px solid var(--stroke-divider)" }}
      >
        <SearchInput value={query} onValueChange={setQuery} placeholder="Employee name" width={240} />
        {filters}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title={q ? "No one by that name" : filtered ? "No timesheets match these filters" : "No timesheets in this period"}
          body={
            q
              ? "Nobody in the list below the filters has that name."
              : filtered
                ? "Clear the site, department or Show filter to see more."
                : "Nothing has been generated yet. Timesheets appear as employees punch."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div
              className="grid items-center gap-x-4 px-4 py-2.5"
              style={{ gridTemplateColumns: COLUMNS, borderBottom: "1px solid var(--stroke-divider)" }}
              role="presentation"
            >
              <span className="wms-overline">Employee</span>
              <span className="wms-overline text-right">Regular</span>
              <span className="wms-overline text-right">Overtime</span>
              <span className="wms-overline text-right">Double</span>
              <span className="wms-overline">Status</span>
              <span className="wms-overline">Next step</span>
              <span />
            </div>

            {groups.map((group) => (
              <Fragment key={group.siteName}>
                {showHeaders && (
                  <div
                    className="flex items-baseline gap-2 px-4 pb-1.5 pt-3"
                    style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                  >
                    <span style={{ font: "var(--type-caption1)", fontWeight: "var(--weight-semibold)", color: "var(--text-secondary)" }}>
                      {group.siteName}
                    </span>
                    <span className="tabular" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                      {group.sheets.length}
                    </span>
                  </div>
                )}
                <ul className="m-0 list-none p-0">
                  {group.sheets.map((ts) => (
                    <li key={ts.id}>
                      {/* The whole row opens the timecard on this period, so
                          middle click and "open in new tab" work. */}
                      <Link
                        href={`/payroll/timecards?periodId=${encodeURIComponent(payPeriodId)}&employeeId=${encodeURIComponent(ts.employeeId)}`}
                        className="ta-hoverable grid min-h-[52px] items-center gap-x-4 px-4 py-2"
                        style={{
                          gridTemplateColumns: COLUMNS,
                          borderBottom: "1px solid var(--stroke-divider)",
                          textDecoration: "none",
                        }}
                        aria-label={`Open ${ts.employeeName}'s timecard`}
                      >
                        <span
                          className="truncate"
                          title={ts.employeeName}
                          style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}
                        >
                          {ts.employeeName}
                        </span>
                        <Num value={ts.reg} />
                        <Num value={ts.ot} tone="var(--text-warning)" />
                        <Num value={ts.dt} tone="var(--text-error)" />
                        <span>
                          <Badge tone={statusTone(ts.status)} size="sm">
                            {(TIMESHEET_STATUS_LABEL as Record<string, string>)[ts.status] ?? ts.status}
                          </Badge>
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                          {ts.exceptions > 0 && (
                            <span
                              className="tabular inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-2"
                              style={{
                                background: "var(--surface-error)",
                                color: "var(--text-error)",
                                font: "var(--type-caption1)",
                                fontWeight: "var(--weight-semibold)",
                              }}
                            >
                              {ts.exceptions} {ts.exceptions === 1 ? "exception" : "exceptions"}
                            </span>
                          )}
                          <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                            {WAITING_ON[ts.status] ?? ""}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Hours in a column: zero is a quiet dash, anything else takes its colour. */
function Num({ value, tone }: { value: number; tone?: string }) {
  return (
    <span
      className="tabular text-right"
      style={{
        font: "var(--type-body1)",
        color: value > 0 ? (tone ?? "var(--text-primary)") : "var(--text-tertiary)",
      }}
    >
      {value > 0 ? hours(value) : "—"}
    </span>
  );
}
