import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { getPayPeriods, getPayPeriodDetail } from "@/actions/pay-period.actions";
import { getAdpConfig } from "@/lib/integrations/adp/client";
import {
  PAY_PERIOD_STATUS_LABEL,
  TIMESHEET_STATUS_LABEL,
  type TimesheetStatusValue,
} from "@/lib/state-machines/labels";
import { PayPeriodActions } from "@/components/payroll/pay-period-actions";
import { PayPeriodsFilter } from "@/components/payroll/pay-periods-filter";
import { format, addDays } from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";
import { PayPeriodTimesheets, type TimesheetRow } from "@/components/payroll/pay-period-timesheets";
import { matchesShow, parseShow, type TimesheetShow } from "@/components/payroll/pay-period-show";
import { PayPeriodDetailFilter } from "@/components/payroll/pay-period-detail-filter";
import { PayPeriodDownload } from "@/components/payroll/pay-period-download";
import { PayPeriodExport } from "@/components/payroll/pay-period-export";
import { CalendarRange, Check, CircleAlert, CircleCheck } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, PageHeader, payPeriodTone } from "@/components/ui";
import { PayPeriodsShell } from "@/components/payroll/pay-periods-shell";

/**
 * Pay Periods: the list of periods on the left, and on the right the period
 * itself. First where its timesheets sit and what is still blocking the close,
 * side by side, then its hours, then every timesheet.
 *
 * <p>Approvals and the checklist lead deliberately. The question this screen
 * exists to answer is "can I close this period, and if not, who am I waiting
 * on"; the hours are what you check once the answer is yes.
 */

const FREQ_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  SEMI_MONTHLY: "Semi-monthly",
  MONTHLY: "Monthly",
};

type FilterValue = "all" | "current" | "ytd";
type StatusFilter = "all" | "open" | "ready" | "locked";

/**
 * A pay period's end date is exclusive — the dashboard, the rail and the
 * period queries all treat it that way — so the last day people can punch is
 * the day before it. Formatting it raw is how the same period came to read
 * "Sep 7 – Sep 20" in the rail and "Sep 7 – Sep 21" in the detail header.
 */
function periodLabel(startDate: Date, endDate: Date): string {
  return `${format(parseUtcDate(startDate), "MMM d")} – ${format(addDays(parseUtcDate(endDate), -1), "MMM d, yyyy")}`;
}

export default async function PayPeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; filter?: string; status?: string; month?: string; siteId?: string; departmentId?: string; show?: string }>;
}) {
  const { id: selectedId, filter, status, month, siteId, departmentId, show: showParam } = await searchParams;
  const show = parseShow(showParam);
  const currentFilter: FilterValue =
    filter === "current" || filter === "ytd" ? filter : "all";
  const statusFilter: StatusFilter =
    status === "open" || status === "ready" || status === "locked" ? status : "all";
  // month param: "YYYY-MM" — when set, overrides scope filter for the visible list
  const monthParam = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : null;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/dashboard");

  const t = session.user.tenantId ?? undefined;

  const ppResult = await getPayPeriods();
  const [sites, departments] = await Promise.all([
    db.site.findMany({
      where: { isActive: true, ...(t ? { tenantId: t } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.department.findMany({
      where: {
        isActive: true,
        ...(t ? { tenantId: t } : {}),
        ...(siteId ? { sites: { some: { siteId } } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const result = ppResult;
  if (!result.success) redirect("/dashboard");

  const allPayPeriods = result.data;
  const currentYear = new Date().getFullYear();

  // Default to the current pay period when none is selected.
  // When multiple rule sets have overlapping current periods, pick the one ending soonest.
  if (!selectedId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentPeriods = allPayPeriods.filter(
      (pp) => parseUtcDate(pp.startDate) <= today && today <= parseUtcDate(pp.endDate)
    );
    const current = currentPeriods.sort(
      (a, b) => parseUtcDate(a.endDate).getTime() - parseUtcDate(b.endDate).getTime()
    )[0];
    if (current) {
      const siteParam = siteId ? `&siteId=${siteId}` : "";
      const deptParam = departmentId ? `&departmentId=${departmentId}` : "";
      redirect(`/payroll/pay-periods?id=${current.id}&filter=current${siteParam}${deptParam}`);
    }
  }

  // Apply scope + status filters for the visible list
  const payPeriods = allPayPeriods.filter((pp) => {
    // Month filter overrides scope when set
    if (monthParam) {
      const [y, m] = monthParam.split("-").map(Number);
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0);
      if (!(parseUtcDate(pp.startDate) <= monthEnd && parseUtcDate(pp.endDate) >= monthStart)) return false;
    } else {
      // Scope filter
      if (currentFilter === "current") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (!(parseUtcDate(pp.startDate) <= today && today <= parseUtcDate(pp.endDate))) return false;
      } else if (currentFilter === "ytd") {
        if (
          parseUtcDate(pp.startDate).getFullYear() !== currentYear &&
          parseUtcDate(pp.endDate).getFullYear() !== currentYear
        ) return false;
      }
    }
    // Status filter always applies
    if (statusFilter === "open") return pp.status === "OPEN";
    if (statusFilter === "ready") return pp.status === "READY";
    if (statusFilter === "locked") return pp.status === "LOCKED";
    return true;
  });

  // Serialise for client component
  const serialisedAll = allPayPeriods.map((pp) => ({
    id: pp.id,
    startDate: pp.startDate.toISOString(),
    endDate: pp.endDate.toISOString(),
    status: pp.status,
    ruleSetId: pp.ruleSetId ?? null,
    ruleSetName: pp.ruleSet?.name ?? null,
    ruleSetFrequency: (pp.ruleSet?.payFrequency ?? null) as string | null,
  }));

  // Fetch detail if a pay period is selected
  let detail: Extract<Awaited<ReturnType<typeof getPayPeriodDetail>>, { success: true }>["data"] | null = null;
  let payrollRun: { id: string; exportedAt: Date | null; pushedCount: number; skippedCount: number; errorCount: number } | null = null;

  if (selectedId) {
    const detailResult = await getPayPeriodDetail({ payPeriodId: selectedId });
    if (detailResult.success) {
      detail = detailResult.data;
      payrollRun = await db.payrollRun.findUnique({
        where: { payPeriodId: selectedId },
        select: { id: true, exportedAt: true, pushedCount: true, skippedCount: true, errorCount: true },
      });
    }
  }

  const adpConfigured = getAdpConfig() !== null;

  const periodText = detail ? periodLabel(detail.payPeriod.startDate, detail.payPeriod.endDate) : null;

  return (
    <PayPeriodsShell
      header={
        <PageHeader
          title="Pay Periods"
          subtitle="Approve, close and export each pay period"
          actions={
            <>
              <LinkButton href="/payroll/timecards" hierarchy="tertiary">
                View timecards
              </LinkButton>
              {/* The period's own actions, for the period open below. */}
              {detail && periodText && (
                <>
                  <PayPeriodExport payPeriodId={detail.payPeriod.id} label={periodText} sites={sites} />
                  <PayPeriodDownload payPeriodId={detail.payPeriod.id} label={periodText} />
                  <PayPeriodActions
                    payPeriodId={detail.payPeriod.id}
                    status={detail.payPeriod.status}
                    isReady={detail.validation.isReady}
                    isPast={parseUtcDate(detail.payPeriod.endDate) < new Date()}
                    adpConfigured={adpConfigured}
                    payrollRun={payrollRun}
                  />
                </>
              )}
            </>
          }
        />
      }
      rail={
        <>
          {/* The count is the difference between "there are no locked
              periods" and "nothing matches these filters", and the second is
              what sends somebody looking for periods that were never generated. */}
          <div className="flex shrink-0 items-baseline justify-between gap-2 px-4 pb-3 pt-3.5">
            <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>Periods</span>
            <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {payPeriods.length}
            </span>
          </div>

          <PayPeriodsFilter
            allPayPeriods={serialisedAll}
            selectedId={selectedId}
            currentFilter={currentFilter}
            statusFilter={statusFilter}
            monthParam={monthParam ?? undefined}
            siteId={siteId}
            departmentId={departmentId}
          />

          <div className="ta-scroll min-h-0 flex-1 overflow-y-auto pb-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
            {payPeriods.length === 0 ? (
              <EmptyState
                title="No pay periods"
                body="Nothing matches the scope, status and month above."
              />
            ) : (
              <PeriodList
                payPeriods={payPeriods}
                selectedId={selectedId}
                currentFilter={currentFilter}
                statusFilter={statusFilter}
                monthParam={monthParam}
                siteId={siteId}
                departmentId={departmentId}
              />
            )}
          </div>
        </>
      }
    >
      {!detail ? (
        <Card>
          <EmptyState
            icon={<CalendarRange className="h-8 w-8" />}
            title="Select a pay period"
            body="Pick one on the left to see what is blocking its close, the hours it holds and every timesheet in it."
          />
        </Card>
      ) : (
        <PeriodDetail
          detail={detail}
          ruleSet={allPayPeriods.find((pp) => pp.id === detail!.payPeriod.id)?.ruleSet ?? null}
          sites={sites}
          departments={departments}
          currentFilter={currentFilter}
          siteId={siteId}
          departmentId={departmentId}
          show={show}
        />
      )}
    </PayPeriodsShell>
  );
}

// ─── Left pane ────────────────────────────────────────────────────────────────

type PayPeriodRow = Extract<
  Awaited<ReturnType<typeof getPayPeriods>>,
  { success: true }
>["data"][number];

/**
 * The list, grouped by date range rather than by rule set.
 *
 * <p>Most rule sets share their dates, so grouped by rule set the same range
 * printed on every row and the one thing that differs, which rule set it is,
 * sat in a band above. Grouped by dates, the range is said once and each row
 * names its rule set. Groups run newest first, as the periods load.
 *
 * <p>Open is the normal state, so only Ready and Locked carry a badge. Rule
 * sets with no timesheets in the range are listed last and dimmed: they are
 * real periods, but there is nothing in them to approve.
 */
function PeriodList({
  payPeriods,
  selectedId,
  currentFilter,
  statusFilter,
  monthParam,
  siteId,
  departmentId,
}: {
  payPeriods: PayPeriodRow[];
  selectedId?: string;
  currentFilter: FilterValue;
  statusFilter: StatusFilter;
  monthParam: string | null;
  siteId?: string;
  departmentId?: string;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groupMap = new Map<string, { start: Date; end: Date; periods: PayPeriodRow[] }>();
  for (const pp of payPeriods) {
    const key = `${pp.startDate.toISOString()}|${pp.endDate.toISOString()}`;
    if (!groupMap.has(key)) groupMap.set(key, { start: pp.startDate, end: pp.endDate, periods: [] });
    groupMap.get(key)!.periods.push(pp);
  }
  const groups = [...groupMap.values()];

  const siteParam = siteId ? `&siteId=${siteId}` : "";
  const deptParam = departmentId ? `&departmentId=${departmentId}` : "";
  const monthHref = monthParam ? `&month=${monthParam}` : "";
  const filterHref = !monthParam && currentFilter !== "all" ? `&filter=${currentFilter}` : "";
  const statusHref = statusFilter !== "all" ? `&status=${statusFilter}` : "";

  return (
    <div className="flex flex-col">
      {groups.map((group) => {
        const isCurrent = parseUtcDate(group.start) <= today && today <= parseUtcDate(group.end);
        const freqs = [...new Set(group.periods.map((pp) => pp.ruleSet?.payFrequency).filter(Boolean))] as string[];
        const rows = [...group.periods].sort(
          (a, b) =>
            Number(a.timesheets.length === 0) - Number(b.timesheets.length === 0) ||
            (a.ruleSet?.name ?? "Default").localeCompare(b.ruleSet?.name ?? "Default"),
        );
        return (
          <section key={`${group.start.toISOString()}|${group.end.toISOString()}`} aria-label={periodLabel(group.start, group.end)}>
            <div
              className="sticky top-0 z-10 flex items-center gap-2 px-4 pb-2 pt-4"
              style={{ background: "var(--surface-card)" }}
            >
              <span className="tabular truncate" style={{ font: "var(--type-body2)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                {periodLabel(group.start, group.end)}
              </span>
              {freqs.length === 1 && (
                <span className="whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                  {FREQ_LABEL[freqs[0]] ?? freqs[0]}
                </span>
              )}
              {isCurrent && (
                <span
                  className="ml-auto whitespace-nowrap rounded-full px-2"
                  style={{
                    background: "var(--surface-info)",
                    color: "var(--text-accent)",
                    font: "var(--type-caption1)",
                    fontWeight: "var(--weight-semibold)",
                    lineHeight: "20px",
                  }}
                >
                  Current
                </span>
              )}
            </div>

            <div className="flex flex-col gap-0.5 px-2">
              {rows.map((pp) => {
                const total = pp.timesheets.length;
                const approved = pp.timesheets.filter(
                  (ts) => ts.status === "PAYROLL_APPROVED" || ts.status === "LOCKED"
                ).length;
                const isSelected = pp.id === selectedId;
                const pct = total > 0 ? (approved / total) * 100 : 0;
                const name = pp.ruleSet?.name ?? "Default";

                return (
                  <Link
                    key={pp.id}
                    href={`/payroll/pay-periods?id=${pp.id}${filterHref}${statusHref}${monthHref}${siteParam}${deptParam}`}
                    className="ta-hoverable flex flex-col gap-1.5 rounded-lg px-3 py-2"
                    data-active={isSelected ? "true" : undefined}
                    aria-current={isSelected ? "page" : undefined}
                    title={name}
                    style={{
                      background: isSelected ? "var(--surface-info)" : undefined,
                      textDecoration: "none",
                      opacity: total === 0 && !isSelected ? 0.6 : 1,
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="min-w-0 flex-1 truncate"
                        style={{
                          font: "var(--type-body1)",
                          fontWeight: isSelected ? "var(--weight-semibold)" : "var(--weight-medium)",
                          color: isSelected ? "var(--text-accent)" : "var(--text-primary)",
                        }}
                      >
                        {name}
                      </span>
                      {pp.status !== "OPEN" && (
                        <Badge tone={payPeriodTone(pp.status)} size="sm">
                          {PAY_PERIOD_STATUS_LABEL[pp.status]}
                        </Badge>
                      )}
                    </span>
                    {/* How much of the period is signed off, as a bar beside
                        the count: the list is scanned down. An empty period
                        has nothing to fill, so it says so instead. */}
                    <span className="flex items-center gap-2.5">
                      {total > 0 && (
                        <span
                          className="block h-1 flex-1 overflow-hidden rounded-full"
                          style={{ background: "var(--ta-track)" }}
                          role="presentation"
                        >
                          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--fill-success)" }} />
                        </span>
                      )}
                      <span className="tabular whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                        {total === 0 ? "No timesheets" : `${approved.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} approved`}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Right pane ───────────────────────────────────────────────────────────────

type Detail = Extract<Awaited<ReturnType<typeof getPayPeriodDetail>>, { success: true }>["data"];

/**
 * Where a timesheet sits and whose move it is, in the order they happen. The
 * bar and the list under it read left to right as the approval chain.
 *
 * <p>Named by role rather than by person: the supervisor of record lives on
 * the employee, and this page does not load it. A role tells a payroll clerk
 * which list to chase.
 */
const STAGES: { status: TimesheetStatusValue; owner: string; color: string }[] = [
  { status: "OPEN",             owner: "Waiting on the employee",   color: "var(--icon-tertiary)" },
  { status: "REJECTED",         owner: "Sent back to the employee", color: "var(--fill-error)" },
  { status: "SUBMITTED",        owner: "Waiting on the supervisor", color: "var(--fill-warning)" },
  { status: "SUP_APPROVED",     owner: "Waiting on payroll",        color: "var(--fill-accent)" },
  { status: "PAYROLL_APPROVED", owner: "Ready to lock",             color: "var(--fill-success)" },
  { status: "LOCKED",           owner: "Closed",                    color: "var(--icon-success)" },
];

function hoursOf(minutes: number): string {
  return (minutes / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A count with thousands separators, as every other figure on the page. */
const n = (v: number) => v.toLocaleString("en-US");

function PeriodDetail({
  detail,
  ruleSet,
  sites,
  departments,
  currentFilter,
  siteId,
  departmentId,
  show,
}: {
  detail: Detail;
  ruleSet: { name: string; payFrequency: string | null } | null;
  sites: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  currentFilter: FilterValue;
  siteId?: string;
  departmentId?: string;
  show: TimesheetShow | "";
}) {
  const { payPeriod, validation } = detail;
  const sheets = payPeriod.timesheets;
  const label = periodLabel(payPeriod.startDate, payPeriod.endDate);
  const lastDay = addDays(parseUtcDate(payPeriod.endDate), -1);
  const lastDayText = format(lastDay, "EEE, MMM d");
  const isPast = parseUtcDate(payPeriod.endDate) < new Date();

  // ── The approval chain, counted once ─────────────────────────────────────
  const byStage = new Map<string, number>();
  for (const ts of sheets) byStage.set(ts.status, (byStage.get(ts.status) ?? 0) + 1);
  const stageCount = (s: TimesheetStatusValue) => byStage.get(s) ?? 0;

  const withEmployee = stageCount("OPEN") + stageCount("REJECTED");
  const withSupervisor = stageCount("SUBMITTED");
  const withPayroll = stageCount("SUP_APPROVED");
  const sheetsWithExceptions = sheets.filter((ts) => ts.exceptions.length > 0).length;

  /**
   * A stage only clears when nothing is still sitting behind it.
   *
   * <p>Counting a stage on its own marked "Supervisor approvals complete" as
   * clear on a period where every sheet was still open (none had reached a
   * supervisor yet, so the SUBMITTED count was zero).
   */
  const awaitingSupervisor = withEmployee + withSupervisor;
  const awaitingPayroll = awaitingSupervisor + withPayroll;
  const payrollApproved = stageCount("PAYROLL_APPROVED") + stageCount("LOCKED");

  // ── Hours, from the buckets the overtime engine wrote ─────────────────────
  let regMin = 0;
  let otMin = 0;
  let dtMin = 0;
  let allMin = 0;
  for (const ts of sheets) {
    for (const b of ts.overtimeBuckets) {
      allMin += b.totalMinutes;
      if (b.bucket === "REG") regMin += b.totalMinutes;
      else if (b.bucket === "OT") otMin += b.totalMinutes;
      else if (b.bucket === "DT") dtMin += b.totalMinutes;
    }
  }
  /** PTO, holiday and anything else the rules engine bucketed by pay code. */
  const otherMin = allMin - regMin - otMin - dtMin;

  // ── Links the checklist hands you to ─────────────────────────────────────
  const baseParams = new URLSearchParams({ id: payPeriod.id });
  if (currentFilter !== "all") baseParams.set("filter", currentFilter);
  if (siteId) baseParams.set("siteId", siteId);
  if (departmentId) baseParams.set("departmentId", departmentId);
  const showHref = (v: TimesheetShow) => {
    const p = new URLSearchParams(baseParams);
    p.set("show", v);
    return `/payroll/pay-periods?${p}#timesheets`;
  };
  const exceptionsHref = `/supervisor/exceptions?payPeriodId=${encodeURIComponent(payPeriod.id)}`;

  // ── The close, as five steps ──────────────────────────────────────────────
  // Every step is derived from the timesheets this page already loaded, so the
  // tracker can never disagree with the table underneath it. Each has a short
  // name for the stepper, a short count under it, the full sentence for when it
  // is the next thing to do, and where to go to clear it.
  const steps: {
    label: string;
    caption: string;
    detail: string;
    done: boolean;
    action?: { href: string; text: string };
  }[] = [
    {
      label: "Period ended",
      caption: isPast ? `Ended ${lastDayText}` : `Ends ${lastDayText}`,
      detail: isPast ? `The last day was ${lastDayText}.` : `Still taking punches until ${lastDayText}.`,
      done: isPast,
    },
    {
      label: "Submitted",
      caption: withEmployee === 0 ? "Done" : `${n(withEmployee)} not submitted`,
      detail: `${n(withEmployee)} ${withEmployee === 1 ? "timesheet has" : "timesheets have"} not been submitted by the employee yet.`,
      done: withEmployee === 0,
      action: withEmployee > 0 ? { href: showHref("employee"), text: `See ${withEmployee === 1 ? "this timesheet" : `these ${n(withEmployee)} timesheets`}` } : undefined,
    },
    {
      label: "Supervisor approved",
      caption: awaitingSupervisor === 0 ? "Done" : `${n(awaitingSupervisor)} waiting`,
      detail: `${n(awaitingSupervisor)} ${awaitingSupervisor === 1 ? "timesheet still needs" : "timesheets still need"} a supervisor to approve ${awaitingSupervisor === 1 ? "it" : "them"}.`,
      done: awaitingSupervisor === 0,
      action: withSupervisor > 0 ? { href: showHref("supervisor"), text: `See ${withSupervisor === 1 ? "this timesheet" : `these ${n(withSupervisor)} timesheets`}` } : undefined,
    },
    {
      label: "Payroll approved",
      caption: awaitingPayroll === 0 ? "Done" : `${n(awaitingPayroll)} waiting`,
      detail: `${n(awaitingPayroll)} ${awaitingPayroll === 1 ? "timesheet still needs" : "timesheets still need"} payroll to approve ${awaitingPayroll === 1 ? "it" : "them"}. ${n(payrollApproved)} of ${n(sheets.length)} are approved.`,
      done: awaitingPayroll === 0,
      action: withPayroll > 0 ? { href: showHref("payroll"), text: `See ${withPayroll === 1 ? "this timesheet" : `these ${n(withPayroll)} timesheets`}` } : undefined,
    },
    {
      label: "Exceptions resolved",
      caption: validation.unresolvedExceptions === 0 ? "Done" : `${n(validation.unresolvedExceptions)} to fix`,
      detail: `${n(validation.unresolvedExceptions)} ${validation.unresolvedExceptions === 1 ? "problem" : "problems"}, like a missed punch, still ${validation.unresolvedExceptions === 1 ? "needs" : "need"} fixing on ${n(sheetsWithExceptions)} ${sheetsWithExceptions === 1 ? "timesheet" : "timesheets"}.`,
      done: validation.unresolvedExceptions === 0,
      action: validation.unresolvedExceptions > 0 ? { href: exceptionsHref, text: "Fix exceptions" } : undefined,
    },
  ];
  const blocking = steps.filter((c) => !c.done);
  // The next thing to do: the first step still open that somebody can act on
  // from here, else the first one still open (the period not having ended).
  const next = blocking.find((c) => c.action) ?? blocking[0] ?? null;

  // ── Where the period stands, as one sentence ─────────────────────────────
  // The ADP push stays in the header, which reports it including straight
  // after a push.
  const standing: { tone: "success" | "warning" | "info"; title: string; text: string } =
    payPeriod.status === "LOCKED"
      ? { tone: "success", title: "Locked", text: "This period is closed. Its hours, time off balances and approved leave are final." }
      : payPeriod.status === "READY"
        ? { tone: "info", title: "Ready to lock", text: "Everything is approved. Lock the period to make its hours final and post time off, then export it to ADP." }
        : !next
          ? { tone: "success", title: "Everything is done", text: "Click Mark Ready at the top to get this period ready for payroll." }
          : {
              tone: "warning",
              title: "This period cannot be closed yet",
              text: `Next step: ${next.detail}`,
            };

  // ── The timesheet table, narrowed the way the filters ask ─────────────────
  const inSiteDept = sheets.filter((ts) => {
    if (siteId && ts.employee.siteId !== siteId) return false;
    if (departmentId && ts.employee.departmentId !== departmentId) return false;
    return true;
  });
  const shown = show ? inSiteDept.filter((ts) => matchesShow(show, ts.status, ts.exceptions.length)) : inSiteDept;
  const rows: TimesheetRow[] = shown.map((ts) => ({
    id: ts.id,
    employeeId: ts.employeeId,
    employeeName: ts.employee.user?.name ?? `Employee ${ts.employeeId}`,
    status: ts.status,
    reg: ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0,
    ot: ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0,
    dt: ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0,
    exceptions: ts.exceptions.length,
    siteId: ts.employee.siteId ?? null,
    siteName: ts.employee.site?.name ?? null,
  }));
  const narrowed = rows.length !== sheets.length;

  const subtitle = [
    ruleSet?.name,
    ruleSet?.payFrequency && (FREQ_LABEL[ruleSet.payFrequency] ?? ruleSet.payFrequency),
    // lastDay, not endDate: endDate is exclusive.
    `Last day ${lastDayText}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const standingColor =
    standing.tone === "warning" ? "var(--text-warning)" : standing.tone === "success" ? "var(--text-success)" : "var(--text-accent)";
  const liveStages = STAGES.filter((st) => stageCount(st.status) > 0);

  return (
    <div className="flex w-full flex-col gap-4">
      {/* The period open, as the heading of this side: a step under the
          page title, with its rule set, frequency and last day under it. */}
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2.5">
          <h2
            className="tabular"
            style={{ margin: 0, font: "var(--type-h2)", fontWeight: "var(--weight-bold)", letterSpacing: "-0.01em", color: "var(--text-primary)" }}
          >
            {label}
          </h2>
          <Badge tone={payPeriodTone(payPeriod.status)}>{PAY_PERIOD_STATUS_LABEL[payPeriod.status]}</Badge>
        </span>
        <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{subtitle}</span>
      </div>

      {/* The close as one slim tracker: the five steps across, then the
          one thing to do next with the way to do it. Every step still open
          links to where it is cleared. */}
      <Card padding={0}>
        {/* One row when the pane has room, as a stepper reads; on a laptop
            it wraps into a tidy grid rather than cutting steps off. Each
            step draws the line to its right and below; the card clips the
            ones at its edge, so a half empty last row stays clean. */}
        <ol className="m-0 grid list-none p-0 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
          {steps.map((st, i) => {
            const isNext = st === next;
            const tone = st.done ? "var(--icon-success)" : isNext ? "var(--fill-warning)" : "var(--stroke-secondary)";
            const inner = (
              <>
                <span className="flex items-center gap-2">
                  <span
                    className="tabular inline-flex h-6 w-6 flex-none items-center justify-center rounded-full"
                    style={{
                      background: st.done ? "var(--surface-success)" : isNext ? "var(--surface-warning)" : "var(--surface-card)",
                      boxShadow: `inset 0 0 0 1.5px ${tone}`,
                      color: st.done ? "var(--icon-success)" : isNext ? "var(--text-warning)" : "var(--text-tertiary)",
                      font: "var(--type-caption1)",
                      fontWeight: "var(--weight-semibold)",
                    }}
                    aria-hidden="true"
                  >
                    {st.done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
                  </span>
                  <span
                    className="truncate"
                    style={{
                      font: "var(--type-body2)",
                      fontWeight: "var(--weight-semibold)",
                      color: st.done ? "var(--text-secondary)" : "var(--text-primary)",
                    }}
                  >
                    {st.label}
                  </span>
                </span>
                <span
                  className="tabular truncate pl-8"
                  style={{
                    font: "var(--type-caption1)",
                    color: st.done ? "var(--text-success)" : isNext ? "var(--text-warning)" : "var(--text-tertiary)",
                    fontWeight: isNext ? "var(--weight-semibold)" : undefined,
                  }}
                >
                  {st.caption}
                </span>
              </>
            );
            return (
              <li
                key={st.label}
                className="min-w-0"
                style={{ boxShadow: "1px 0 0 var(--stroke-divider), 0 1px 0 var(--stroke-divider)" }}
                aria-current={isNext ? "step" : undefined}
              >
                {st.action ? (
                  <Link
                    href={st.action.href}
                    className="ta-hoverable flex h-full flex-col gap-1 px-4 py-3"
                    style={{ textDecoration: "none" }}
                    title={st.detail}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex h-full flex-col gap-1 px-4 py-3" title={st.detail}>
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--stroke-divider)", background: standing.tone === "warning" ? "var(--surface-warning)" : standing.tone === "success" ? "var(--surface-success)" : "var(--surface-info)" }}
        >
          <span className="inline-flex flex-none" style={{ color: standingColor }}>
            {standing.tone === "warning" ? <CircleAlert className="h-5 w-5" aria-hidden="true" /> : <CircleCheck className="h-5 w-5" aria-hidden="true" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
              {standing.title}
            </span>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{standing.text}</span>
          </span>
          {next?.action && payPeriod.status === "OPEN" && (
            <LinkButton href={next.action.href} hierarchy="secondary" size="sm">
              {next.action.text}
            </LinkButton>
          )}
        </div>
      </Card>

      {/* The period in numbers, one row, then where its timesheets sit in the
          approval chain as one bar with a chip per stage that has anyone in it. */}
      <Card padding={0}>
        <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,128px),1fr))]">
          {[
            { label: "Timesheets", value: n(sheets.length) },
            { label: "Approved", value: `${n(payrollApproved)} of ${n(sheets.length)}`, tone: payrollApproved === sheets.length && sheets.length > 0 ? "var(--text-success)" : undefined },
            { label: "Exceptions", value: n(validation.unresolvedExceptions), sub: validation.unresolvedExceptions ? `${n(sheetsWithExceptions)} ${sheetsWithExceptions === 1 ? "person" : "people"}` : undefined, tone: validation.unresolvedExceptions ? "var(--text-error)" : undefined },
            { label: "Total hours", value: hoursOf(allMin), strong: true },
            { label: "Regular", value: hoursOf(regMin) },
            { label: "Overtime", value: hoursOf(otMin), tone: otMin > 0 ? "var(--text-warning)" : undefined },
            { label: "Double time", value: hoursOf(dtMin), tone: dtMin > 0 ? "var(--text-error)" : undefined },
            // Named, not dropped, because the hour figures have to add up to
            // the total: PTO, holiday and other pay codes.
            { label: "Other pay codes", value: hoursOf(otherMin) },
          ].map((kv, i) => (
            <div
              key={kv.label}
              className="flex min-w-0 flex-col gap-1 px-4 py-3.5"
              style={{ borderLeft: i === 0 ? undefined : "1px solid var(--stroke-divider)" }}
            >
              <span className="wms-overline truncate">{kv.label}</span>
              <span
                className="tabular truncate"
                style={{
                  font: "var(--type-h4)",
                  fontWeight: kv.strong ? "var(--weight-bold)" : "var(--weight-semibold)",
                  color: kv.tone ?? "var(--text-primary)",
                }}
              >
                {kv.value}
              </span>
              {kv.sub && (
                <span className="truncate" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                  {kv.sub}
                </span>
              )}
            </div>
          ))}
        </div>

        {sheets.length > 0 && (
          <div className="flex flex-col gap-2.5 px-4 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
            <div
              className="flex h-2 w-full overflow-hidden rounded-full"
              style={{ background: "var(--ta-track)", gap: 2 }}
              role="img"
              aria-label={liveStages.map((st) => `${TIMESHEET_STATUS_LABEL[st.status]} ${stageCount(st.status)}`).join(", ")}
            >
              {liveStages.map((st) => (
                <span
                  key={st.status}
                  className="block h-full"
                  style={{ width: `${(stageCount(st.status) / sheets.length) * 100}%`, background: st.color }}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {liveStages.map((st) => (
                <span key={st.status} className="inline-flex items-center gap-1.5 whitespace-nowrap" title={st.owner}>
                  <span className="h-2 w-2 flex-none rounded-full" style={{ background: st.color }} aria-hidden="true" />
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                    {TIMESHEET_STATUS_LABEL[st.status]}
                  </span>
                  <span className="tabular" style={{ font: "var(--type-body2)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                    {n(stageCount(st.status))}
                  </span>
                  <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                    {st.owner.toLowerCase()}
                  </span>
                </span>
              ))}
              <span className="ml-auto" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                Every timesheet in the period, before the filters below
              </span>
            </div>
          </div>
        )}
      </Card>

      <div id="timesheets" style={{ scrollMarginTop: "calc(var(--pp-bar) + 1rem)" }}>
        <Card
          title="Timesheets"
          subtitle={
            narrowed
              ? `${n(rows.length)} of ${n(sheets.length)} timesheets match the filters`
              : `${n(sheets.length)} timesheet${sheets.length === 1 ? "" : "s"} in this period`
          }
          padding={0}
        >
          <PayPeriodTimesheets
            timesheets={rows}
            payPeriodId={payPeriod.id}
            filtered={narrowed}
            filters={
              <PayPeriodDetailFilter
                payPeriodId={payPeriod.id}
                currentFilter={currentFilter}
                sites={sites}
                departments={departments}
                selectedSiteId={siteId}
                selectedDepartmentId={departmentId}
                show={show}
              />
            }
          />
        </Card>
      </div>
    </div>
  );
}
