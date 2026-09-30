"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Clock } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Badge, Button, SearchInput, SegmentedControl } from "@/components/ui";
import { PpSelect } from "@/components/payroll/pp-select";
import { SHOW_OPTIONS, type TimesheetShow } from "./pay-period-show";

/**
 * Every timesheet in the pay period, grouped by site, from the Pay Periods
 * handoff: a round state icon, the person and their hours as chips, whether the
 * timesheet is open or locked, and a count of its unresolved exceptions that
 * opens into the reasons.
 *
 * <p>Two narrowings, kept apart on purpose. Site, department and Show live in
 * the link: a clerk working one warehouse sends it to that warehouse's
 * supervisor, and the page summary's "See these timesheets" lands on a
 * Show. The name search and All / With issues / No issues only narrow what
 * is already on the screen.
 *
 * <p>The row opens the person's timecard on this period.
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

type IssueMode = "all" | "issues" | "clear";

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };
const n = (v: number) => v.toLocaleString("en-US");
const hours = (minutes: number) => (minutes / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lockedStatus = (s: string) => s === "LOCKED";

function issuesOf(ts: TimesheetRow): string[] {
  const out: string[] = [];
  if (ts.exceptions > 0) out.push(`${n(ts.exceptions)} unresolved ${ts.exceptions === 1 ? "exception" : "exceptions"}, like a missed punch`);
  return out;
}

function Chip({ k, v, tone }: { k: string; v: string; tone: "reg" | "ot" | "dt" }) {
  const bg = tone === "reg" ? "var(--ta-well)" : tone === "ot" ? "var(--surface-warning)" : "var(--surface-error)";
  const fg = tone === "reg" ? "var(--text-secondary)" : tone === "ot" ? "var(--text-warning)" : "var(--text-error)";
  return (
    <span className="tabular inline-flex h-5 items-center gap-1 whitespace-nowrap px-[7px]" style={{ borderRadius: 6, background: bg, font: "var(--weight-medium) 11.5px/1 var(--font-sans)", color: fg }}>
      <b style={{ fontWeight: 700, letterSpacing: ".04em" }}>{k}</b>
      {v}
    </span>
  );
}

export function PayPeriodTimesheets({
  timesheets,
  total,
  payPeriodId,
  baseQuery,
  sites,
  departments,
  siteId,
  departmentId,
  show,
}: {
  /** The period's timesheets after the site, department and Show filters. */
  timesheets: TimesheetRow[];
  /** Every timesheet in the period, before any filter. */
  total: number;
  payPeriodId: string;
  /** The page's own query (id, scope, status, month) that filter links keep. */
  baseQuery: string;
  sites: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  siteId?: string;
  departmentId?: string;
  show: TimesheetShow | "";
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<IssueMode>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  function go(next: { siteId?: string | null; departmentId?: string | null; show?: string | null }) {
    const params = new URLSearchParams(baseQuery);
    const site = next.siteId === undefined ? siteId : next.siteId;
    const dept = next.departmentId === undefined ? departmentId : next.departmentId;
    const shown = next.show === undefined ? show : next.show;
    params.delete("siteId");
    params.delete("departmentId");
    params.delete("show");
    if (site) params.set("siteId", site);
    if (dept) params.set("departmentId", dept);
    if (shown) params.set("show", shown);
    router.push(`/payroll/pay-periods?${params}#timesheets`, { scroll: false });
  }

  const q = query.trim().toLowerCase();
  const visible = timesheets.filter((ts) => {
    if (q && !ts.employeeName.toLowerCase().includes(q)) return false;
    if (mode === "all") return true;
    const has = issuesOf(ts).length > 0;
    return mode === "issues" ? has : !has;
  });

  const groupMap = new Map<string, { siteName: string; sheets: TimesheetRow[] }>();
  for (const ts of visible) {
    const key = ts.siteId ?? "__none__";
    if (!groupMap.has(key)) groupMap.set(key, { siteName: ts.siteName ?? "No site", sheets: [] });
    groupMap.get(key)!.sheets.push(ts);
  }
  const groups = [...groupMap.values()].sort((a, b) =>
    a.siteName === "No site" ? 1 : b.siteName === "No site" ? -1 : a.siteName.localeCompare(b.siteName),
  );
  for (const g of groups) g.sheets.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const linkFiltered = Boolean(siteId || departmentId || show);
  const narrowed = visible.length !== total;
  const subtitle = narrowed
    ? `${n(visible.length)} of ${n(total)} ${total === 1 ? "timesheet" : "timesheets"} shown`
    : `${n(total)} ${total === 1 ? "timesheet" : "timesheets"} in this period`;

  const empty =
    total === 0
      ? { title: "No timesheets in this period", body: "Nothing has been generated yet. Timesheets appear as employees punch." }
      : q
        ? { title: "No one by that name", body: "Nobody in the list under these filters has that name." }
        : { title: "No timesheets match these filters", body: "Clear the Show, site or department filter, or pick All, to see more." };

  return (
    <section id="timesheets" style={{ ...PANEL, scrollMarginTop: "calc(var(--pp-bar, 0px) + 12px)" }}>
      <div className="relative z-[4] flex flex-wrap items-center gap-2 pb-3 pl-5 pr-4 pt-4">
        <span className="mr-auto flex min-w-0 flex-col gap-0.5">
          <h3 className="m-0" style={{ font: "var(--weight-semibold) 16px/22px var(--font-sans)", color: "var(--text-primary)" }}>
            Timesheets
          </h3>
          <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            {subtitle}
          </span>
        </span>
        <SegmentedControl
          size="sm"
          ariaLabel="Issues"
          value={mode}
          onChange={(v) => setMode(v as IssueMode)}
          items={[
            { value: "all", label: "All" },
            { value: "issues", label: "With issues" },
            { value: "clear", label: "No issues" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <SearchInput value={query} onValueChange={setQuery} placeholder="Employee name" width={220} />
        <PpSelect
          label="Show"
          value={show}
          onChange={(v) => go({ show: v || null })}
          options={[{ value: "", label: "Every timesheet" }, ...SHOW_OPTIONS.map((o) => ({ value: o.id, label: o.name }))]}
        />
        <PpSelect
          label="Site"
          value={siteId ?? ""}
          onChange={(v) => go({ siteId: v || null, departmentId: null })}
          options={[{ value: "", label: "All sites" }, ...sites.map((s) => ({ value: s.id, label: s.name }))]}
        />
        <PpSelect
          label="Department"
          value={departmentId ?? ""}
          onChange={(v) => go({ departmentId: v || null })}
          options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
        />
        {linkFiltered && (
          <Button hierarchy="link" size="sm" onClick={() => go({ siteId: null, departmentId: null, show: null })}>
            Clear all
          </Button>
        )}
      </div>

      <div className="px-2 pb-2">
        {groups.map((g) => (
          <div key={g.siteName}>
            <div className="flex items-center gap-2.5 px-3 pb-1.5 pt-2.5">
              <span style={{ font: "var(--weight-semibold) 11px/14px var(--font-sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                {g.siteName}
              </span>
              <span className="tabular" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                {n(g.sheets.length)}
              </span>
              <span className="h-px flex-1" style={{ background: "var(--ta-well-ring)" }} />
            </div>
            {g.sheets.map((ts) => {
              const iss = issuesOf(ts);
              const expanded = !!open[ts.id] && iss.length > 0;
              const done = lockedStatus(ts.status);
              const Icon = ts.exceptions ? CircleAlert : done ? CircleCheck : Clock;
              const href = `/payroll/timecards?periodId=${encodeURIComponent(payPeriodId)}&employeeId=${encodeURIComponent(ts.employeeId)}`;
              return (
                <div
                  key={ts.id}
                  className="mb-0.5"
                  style={{ borderRadius: 14, background: expanded ? "var(--ta-well)" : undefined, boxShadow: expanded ? "inset 0 0 0 1px var(--ta-well-ring)" : undefined }}
                >
                  <div className="flex min-h-[60px] flex-wrap items-center gap-x-3.5 gap-y-2 py-2 pl-3 pr-2">
                    <Link
                      href={href}
                      aria-label={`Open ${ts.employeeName}'s timecard`}
                      className="ta-row-btn -my-1 -ml-1.5 flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-x-3.5 gap-y-1.5 py-1 pl-1.5 pr-2"
                      style={{ textDecoration: "none" }}
                    >
                      <span
                        className="grid h-9 w-9 flex-none place-items-center rounded-full"
                        style={{
                          background: ts.exceptions ? "var(--surface-error)" : done ? "var(--surface-success)" : "var(--ta-well)",
                          color: ts.exceptions ? "var(--icon-error)" : done ? "var(--icon-success)" : "var(--icon-secondary)",
                        }}
                      >
                        <Icon className="h-[18px] w-[18px]" aria-hidden />
                      </span>
                      <span className="flex min-w-[120px] flex-[1_1_160px] flex-col gap-[3px]">
                        <span className="truncate" title={ts.employeeName} style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
                          {ts.employeeName}
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Chip k="REG" v={hours(ts.reg)} tone="reg" />
                          {ts.ot > 0 && <Chip k="OT" v={hours(ts.ot)} tone="ot" />}
                          {ts.dt > 0 && <Chip k="DT" v={hours(ts.dt)} tone="dt" />}
                        </span>
                      </span>
                      <Badge tone={done ? "success" : "neutral"} dot>
                        {done ? "Locked" : "Open"}
                      </Badge>
                    </Link>
                    {iss.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [ts.id]: !o[ts.id] }))}
                        aria-expanded={expanded}
                        className="inline-flex h-[26px] flex-none items-center gap-1 whitespace-nowrap pl-2.5 pr-2"
                        style={{ border: 0, borderRadius: 999, background: "var(--surface-error)", cursor: "pointer", font: "var(--weight-medium) 12px/1 var(--font-sans)", color: "var(--text-error)" }}
                      >
                        {iss.length} {iss.length === 1 ? "issue" : "issues"}
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }} />
                      </button>
                    )}
                    <Link href={href} tabIndex={-1} aria-hidden className="ta-icon-btn h-7 w-7" style={{ borderRadius: 8, color: "var(--icon-disabled)" }}>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                  {expanded && (
                    <ul className="m-0 flex list-none flex-col gap-1.5 pb-3.5 pl-[62px] pr-3 pt-0.5">
                      {iss.map((t) => (
                        <li key={t} className="flex items-center gap-2" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                          <CircleAlert className="h-4 w-4 flex-none" aria-hidden style={{ color: "var(--icon-error)" }} />
                          {t}
                        </li>
                      ))}
                      {ts.exceptions > 0 && (
                        <li className="pl-6">
                          <Link
                            href={`/supervisor/exceptions?payPeriodId=${encodeURIComponent(payPeriodId)}`}
                            style={{ font: "var(--weight-medium) 13px/18px var(--font-sans)", color: "var(--text-accent)", textDecoration: "none" }}
                          >
                            Fix exceptions
                          </Link>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>{empty.title}</span>
            <span style={{ maxWidth: 380, font: "var(--type-body2)", color: "var(--text-secondary)" }}>{empty.body}</span>
          </div>
        )}
      </div>
    </section>
  );
}
