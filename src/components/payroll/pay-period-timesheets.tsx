"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { formatMinutes } from "@/lib/utils/duration";
import { TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/labels";
import { Badge, Button, EmptyState, TBody, TD, TH, THead, TR, Table, statusTone } from "@/components/ui";

/**
 * Every timesheet in the pay period, as the doc template's table section.
 *
 * <p>These used to be one card per employee. On a 214-person period that is
 * 214 stacked panels, and the two numbers payroll actually reads down — OT and
 * DT — sat inline in a sentence, so spotting the one person with double time
 * meant reading every card. A table puts them in a column.
 *
 * <p>The blocking issues stay behind a disclosure rather than printing under
 * every row: on a healthy period they are all empty, and a permanently
 * expanded detail area would double the height of a clean list to say nothing.
 */

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

/** How far along the approval chain a sheet is, at a glance. */
function StateIcon({ ts }: { ts: TimesheetTile }) {
  const approved = ts.status === "PAYROLL_APPROVED" || ts.status === "LOCKED";
  if (ts.hasExceptions) {
    return (
      <AlertCircle
        className="h-4 w-4"
        style={{ color: "var(--icon-error)" }}
        aria-label="Has unresolved exceptions"
      />
    );
  }
  if (approved) {
    return (
      <CheckCircle2 className="h-4 w-4" style={{ color: "var(--icon-success)" }} aria-label="Approved" />
    );
  }
  return <Clock className="h-4 w-4" style={{ color: "var(--icon-tertiary)" }} aria-label="Not yet approved" />;
}

export function PayPeriodTimesheets({
  timesheets,
  payPeriodId,
  filtered = false,
}: {
  timesheets: TimesheetTile[];
  payPeriodId: string;
  /** Whether a site or department filter is narrowing the list above. */
  filtered?: boolean;
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
      <EmptyState
        title={filtered ? "No timesheets in view" : "No timesheets in this period"}
        body={
          filtered
            ? "No timesheet in this pay period matches the site and department filters above."
            : "Nothing has been generated yet. Timesheets appear as employees punch."
        }
      />
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

  const COLS = 7;

  return (
    <Table>
      <THead>
        <TR>
          {/* The state glyph has no header: it repeats the Status column in a
              form you can scan down, and labelling it twice reads as two
              different facts. */}
          <TH style={{ width: 34 }} aria-label="State" />
          <TH>Employee</TH>
          <TH numeric>Reg</TH>
          <TH numeric>OT</TH>
          <TH numeric>DT</TH>
          <TH>Status</TH>
          <TH align="right">Blocking</TH>
        </TR>
      </THead>
      <TBody>
        {groups.map((group) => (
          <Fragment key={group.siteName}>
            {showHeaders && (
              <TR
                style={{
                  // Inline, not a class: .ta-row's hover rule would otherwise
                  // light the group header up as though it were a record.
                  background: "var(--surface-secondary)",
                }}
              >
                <TD
                  colSpan={COLS}
                  className="wms-overline"
                  style={{ height: 28, color: "var(--text-tertiary)" }}
                >
                  {group.siteName}
                </TD>
              </TR>
            )}

            {group.sheets.map((ts) => {
              const open = expanded.has(ts.id);
              return (
                <Fragment key={ts.id}>
                  <TR>
                    <TD style={{ paddingRight: 0 }}>
                      <StateIcon ts={ts} />
                    </TD>
                    <TD>
                      <Link
                        href={`/payroll/timecards?payPeriodId=${payPeriodId}&employeeId=${ts.employeeId}`}
                        style={{
                          color: "var(--text-primary)",
                          fontWeight: "var(--weight-medium)",
                          textDecoration: "none",
                        }}
                        className="hover:underline"
                      >
                        {ts.employeeName}
                      </Link>
                    </TD>
                    <TD numeric>{formatMinutes(ts.reg)}</TD>
                    <TD numeric style={{ color: ts.ot > 0 ? "var(--text-warning)" : "var(--text-tertiary)" }}>
                      {ts.ot > 0 ? formatMinutes(ts.ot) : "—"}
                    </TD>
                    <TD numeric style={{ color: ts.dt > 0 ? "var(--text-error)" : "var(--text-tertiary)" }}>
                      {ts.dt > 0 ? formatMinutes(ts.dt) : "—"}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(ts.status)} size="sm">
                        {(TIMESHEET_STATUS_LABEL as Record<string, string>)[ts.status] ?? ts.status}
                      </Badge>
                    </TD>
                    <TD align="right">
                      {ts.issues.length === 0 ? (
                        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>—</span>
                      ) : (
                        <Button
                          hierarchy="link"
                          tone="error"
                          size="sm"
                          onClick={() => toggle(ts.id)}
                          aria-expanded={open}
                          trailingIcon={
                            open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          }
                        >
                          {ts.issues.length} issue{ts.issues.length === 1 ? "" : "s"}
                        </Button>
                      )}
                    </TD>
                  </TR>

                  {open && ts.issues.length > 0 && (
                    <TR style={{ background: "var(--surface-error)" }}>
                      <TD colSpan={COLS} style={{ height: "auto", padding: "10px 14px" }}>
                        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                          {ts.issues.map((issue, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2"
                              style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}
                            >
                              <AlertCircle
                                className="mt-0.5 h-3.5 w-3.5 flex-none"
                                style={{ color: "var(--icon-error)" }}
                                aria-hidden="true"
                              />
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </TD>
                    </TR>
                  )}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </TBody>
    </Table>
  );
}
