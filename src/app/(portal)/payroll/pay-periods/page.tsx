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
import { PayPeriodTimesheets } from "@/components/payroll/pay-period-timesheets";
import { PayPeriodDetailFilter } from "@/components/payroll/pay-period-detail-filter";
import { PayPeriodDownload } from "@/components/payroll/pay-period-download";
import { PayPeriodExport } from "@/components/payroll/pay-period-export";
import { CalendarRange, CircleCheck, CircleDashed } from "lucide-react";
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  PageHeader,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
  Table,
  Toolbar,
  statusTone,
  payPeriodTone,
  type BannerTone,
} from "@/components/ui";

/**
 * Pay Periods, as the portal design lays the screen out: the list rail on the
 * left, and on the right the period itself as a document — what is blocking
 * the close, then the totals, then the timesheets.
 *
 * <p>The checklist leads deliberately. The question this screen exists to
 * answer is "can I close this period, and if not, who am I waiting on"; the
 * hours are what you check once the answer is yes. The previous layout opened
 * with three stat tiles, which meant the three numbers that tell you the
 * period is *not* closeable were the last thing on the page.
 */

const FREQ_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  SEMI_MONTHLY: "Semi-monthly",
  MONTHLY: "Monthly",
};

/**
 * Who the next move belongs to at each stage.
 *
 * <p>Named by role rather than by person: the supervisor of record lives on
 * the employee, and this page does not load it. A role tells a payroll clerk
 * which list to chase, which is what the column is for.
 */
const STAGE_OWNER: Record<TimesheetStatusValue, string> = {
  OPEN:             "Employee",
  REJECTED:         "Employee",
  SUBMITTED:        "Supervisor",
  SUP_APPROVED:     "Payroll",
  PAYROLL_APPROVED: "Ready to lock",
  LOCKED:           "Closed",
};

/** The approval chain in order, so the table reads as a pipeline. */
const STAGE_ORDER: TimesheetStatusValue[] = [
  "OPEN",
  "REJECTED",
  "SUBMITTED",
  "SUP_APPROVED",
  "PAYROLL_APPROVED",
  "LOCKED",
];

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
  searchParams: Promise<{ id?: string; filter?: string; status?: string; month?: string; siteId?: string; departmentId?: string }>;
}) {
  const { id: selectedId, filter, status, month, siteId, departmentId } = await searchParams;
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

  return (
    <div className="ta-bleed flex items-start gap-0">
      {/* ── Left pane: the list ──────────────────────────────── */}
      <aside
        className="sticky top-0 flex h-full w-80 shrink-0 flex-col overflow-hidden"
        style={{ borderRight: "1px solid var(--stroke-secondary)" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-6 pb-3">
          {/* A panel title, not a page title: PageHeader's 30px would swamp a
              320px column. --type-h3 is the design's panel/slide-out size. */}
          <h1 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>Pay Periods</h1>
          <Link
            href="/payroll/timecards"
            style={{ font: "var(--type-button2)", color: "var(--text-accent)" }}
            className="hover:underline"
          >
            Timecards
          </Link>
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

        {/* The count is the difference between "there are no locked periods"
            and "no period matches these three filters", and the second is what
            sends somebody looking for periods that were never generated. */}
        <div
          className="shrink-0 px-4 py-2"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <Toolbar count={payPeriods.length} countLabel="period" />
        </div>

        <div className="flex-1 overflow-y-auto">
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
      </aside>

      {/* ── Right pane: the period as a document ─────────────── */}
      {/* Scrolls on its own, inside 24px of padding rather than the page's
          16px, so the pinned title is told how far to reach. */}
      <div
        className="h-full flex-1 overflow-y-auto px-6 py-6"
        style={{
          ["--pin-x" as string]: "1.5rem",
          ["--pin-t" as string]: "1.5rem",
          ["--pin-stick" as string]: "-1.5rem",
        }}
      >
        {!detail ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<CalendarRange className="h-8 w-8" />}
              title="Select a pay period"
              body="Pick one on the left to see what is blocking its close, the hours it holds and every timesheet in it."
            />
          </div>
        ) : (
          <PeriodDetail
            detail={detail}
            ruleSet={allPayPeriods.find((pp) => pp.id === detail!.payPeriod.id)?.ruleSet ?? null}
            payrollRun={payrollRun}
            adpConfigured={adpConfigured}
            sites={sites}
            departments={departments}
            currentFilter={currentFilter}
            siteId={siteId}
            departmentId={departmentId}
          />
        )}
      </div>
    </div>
  );
}

// ─── Left pane ────────────────────────────────────────────────────────────────

type PayPeriodRow = Extract<
  Awaited<ReturnType<typeof getPayPeriods>>,
  { success: true }
>["data"][number];

/**
 * The rail, grouped by rule set.
 *
 * <p>The headers only appear when there is more than one rule set. A single
 * "Default" band above every row in a 320px column is a heading that carries
 * no information and costs a line per group.
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
  const groupMap = new Map<
    string,
    { name: string; frequency: string | null; periods: PayPeriodRow[] }
  >();
  for (const pp of payPeriods) {
    const key = pp.ruleSetId ?? "__tenant__";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        name: pp.ruleSet?.name ?? "Default",
        frequency: (pp.ruleSet?.payFrequency as string | null | undefined) ?? null,
        periods: [],
      });
    }
    groupMap.get(key)!.periods.push(pp);
  }
  const groups = [...groupMap.values()];
  const showHeaders = groups.length > 1;

  const siteParam = siteId ? `&siteId=${siteId}` : "";
  const deptParam = departmentId ? `&departmentId=${departmentId}` : "";
  const monthHref = monthParam ? `&month=${monthParam}` : "";
  const filterHref = !monthParam && currentFilter !== "all" ? `&filter=${currentFilter}` : "";
  const statusHref = statusFilter !== "all" ? `&status=${statusFilter}` : "";

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.name}>
          {showHeaders && (
            <div
              className="sticky top-0 z-10 px-4 py-1.5"
              style={{
                background: "var(--surface-secondary)",
                borderBottom: "1px solid var(--stroke-divider)",
              }}
            >
              <p className="wms-overline" style={{ margin: 0 }}>
                {group.name}
                {group.frequency && (
                  <span style={{ textTransform: "none", color: "var(--text-tertiary)" }}>
                    {" · "}
                    {FREQ_LABEL[group.frequency] ?? group.frequency}
                  </span>
                )}
              </p>
            </div>
          )}

          {group.periods.map((pp) => {
            const total = pp.timesheets.length;
            const approved = pp.timesheets.filter(
              (ts) => ts.status === "PAYROLL_APPROVED" || ts.status === "LOCKED"
            ).length;
            const isSelected = pp.id === selectedId;
            const pct = total > 0 ? (approved / total) * 100 : 0;

            return (
              <Link
                key={pp.id}
                href={`/payroll/pay-periods?id=${pp.id}${filterHref}${statusHref}${monthHref}${siteParam}${deptParam}`}
                className="ta-hoverable flex flex-col gap-1.5 px-4 py-3"
                data-active={isSelected ? "true" : undefined}
                style={{
                  borderBottom: "1px solid var(--stroke-divider)",
                  borderLeft: `2px solid ${isSelected ? "var(--stroke-accent)" : "transparent"}`,
                  background: isSelected ? "var(--surface-info)" : undefined,
                  textDecoration: "none",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="tabular truncate"
                    style={{
                      font: "var(--type-body1)",
                      fontWeight: "var(--weight-semibold)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {periodLabel(pp.startDate, pp.endDate)}
                  </span>
                  <span className="shrink-0">
                    <Badge tone={payPeriodTone(pp.status)} size="sm">
                      {PAY_PERIOD_STATUS_LABEL[pp.status]}
                    </Badge>
                  </span>
                </div>

                {/* How much of the period is signed off, as a bar rather than
                    a fraction alone: the rail is scanned down, and "182/214"
                    on six rows is six sums to do. */}
                <div className="flex items-center gap-2">
                  <span
                    className="h-1 flex-1 overflow-hidden rounded-full"
                    style={{ background: "var(--ta-track)" }}
                    role="presentation"
                  >
                    <span
                      className="block h-full"
                      style={{ width: `${pct}%`, background: "var(--fill-success)" }}
                    />
                  </span>
                  <span
                    className="tabular shrink-0"
                    style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                  >
                    {total === 0 ? "no timesheets" : `${approved}/${total} approved`}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Right pane ───────────────────────────────────────────────────────────────

type Detail = Extract<Awaited<ReturnType<typeof getPayPeriodDetail>>, { success: true }>["data"];

function PeriodDetail({
  detail,
  ruleSet,
  payrollRun,
  adpConfigured,
  sites,
  departments,
  currentFilter,
  siteId,
  departmentId,
}: {
  detail: Detail;
  ruleSet: { name: string; payFrequency: string | null } | null;
  payrollRun: { id: string; exportedAt: Date | null; pushedCount: number; skippedCount: number; errorCount: number } | null;
  adpConfigured: boolean;
  sites: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  currentFilter: FilterValue;
  siteId?: string;
  departmentId?: string;
}) {
  const { payPeriod, validation } = detail;
  const sheets = payPeriod.timesheets;
  const label = periodLabel(payPeriod.startDate, payPeriod.endDate);
  const lastDay = addDays(parseUtcDate(payPeriod.endDate), -1);
  const isPast = parseUtcDate(payPeriod.endDate) < new Date();

  // ── The approval pipeline, counted once and used three times ──────────────
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
   * clear on a period where every sheet was still open — none had reached a
   * supervisor yet, so the SUBMITTED count was zero — and the checklist then
   * contradicted the banner directly above it.
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

  // ── The close checklist ───────────────────────────────────────────────────
  // Every row is derived from the timesheets this page already loaded, so the
  // checklist can never disagree with the table underneath it.
  const checklist: { label: string; detail: string; done: boolean }[] = [
    {
      label: "Period has ended",
      detail: isPast
        ? `Last day was ${format(lastDay, "EEE d MMM")}`
        : `Still taking punches until ${format(lastDay, "EEE d MMM")}`,
      done: isPast,
    },
    {
      label: "Every timesheet out of the employees' hands",
      detail:
        withEmployee === 0
          ? "Nothing left open or returned"
          : `${withEmployee} still open or returned for edit`,
      done: withEmployee === 0,
    },
    {
      label: "Supervisor approvals complete",
      detail:
        awaitingSupervisor === 0
          ? "Every timesheet carries a supervisor sign-off"
          : `${awaitingSupervisor} still without a supervisor sign-off`,
      done: awaitingSupervisor === 0,
    },
    {
      label: "Payroll approvals complete",
      detail: `${payrollApproved} of ${sheets.length} approved by payroll`,
      done: awaitingPayroll === 0,
    },
    {
      label: "Exceptions resolved",
      detail:
        validation.unresolvedExceptions === 0
          ? "No unresolved exception in this period"
          : `${validation.unresolvedExceptions} unresolved across ${sheetsWithExceptions} timesheet${sheetsWithExceptions === 1 ? "" : "s"}`,
      done: validation.unresolvedExceptions === 0,
    },
  ];

  // ── The banner: the one sentence about where this period stands ───────────
  // The ADP push deliberately stays out of this: PayPeriodActions reports it
  // in the header, including straight after a push, and a second copy here
  // would be the same fact written from a different moment in time.
  const banner: { tone: BannerTone; title: string; body: string } =
    payPeriod.status === "LOCKED"
      ? {
          tone: "success",
          title: "Period locked",
          body: `${stageCount("LOCKED")} timesheet${stageCount("LOCKED") === 1 ? " is" : "s are"} locked. Accruals and approved leave for this period have been posted.`,
        }
      : payPeriod.status === "READY"
        ? {
            tone: "info",
            title: "Ready to lock",
            body: "Every timesheet is payroll-approved and every exception is resolved. Locking posts per-period accruals and any approved leave that overlaps the period.",
          }
        : validation.isReady
          ? {
              tone: "success",
              title: "Nothing is blocking the close",
              body: "Every timesheet in this period is payroll-approved with no unresolved exceptions.",
            }
          : {
              tone: "warning",
              title: `${validation.issues.length} item${validation.issues.length === 1 ? "" : "s"} blocking the close`,
              body: "The period cannot be marked ready until each one clears. The checklist below says who they are waiting on.",
            };

  // ── The timesheet table, narrowed the way the filters ask ─────────────────
  const issuesByTs = new Map<string, string[]>();
  for (const iss of validation.issues) {
    const list = issuesByTs.get(iss.timesheetId) ?? [];
    list.push(iss.issue);
    issuesByTs.set(iss.timesheetId, list);
  }
  const filteredSheets = sheets.filter((ts) => {
    if (siteId && ts.employee.siteId !== siteId) return false;
    if (departmentId && ts.employee.departmentId !== departmentId) return false;
    return true;
  });
  const tileData = filteredSheets.map((ts) => ({
    id: ts.id,
    employeeId: ts.employeeId,
    employeeName: ts.employee.user?.name ?? `Employee ${ts.employeeId}`,
    status: ts.status,
    reg: ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0,
    ot: ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0,
    dt: ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0,
    hasExceptions: ts.exceptions.length > 0,
    issues: issuesByTs.get(ts.id) ?? [],
    siteId: ts.employee.siteId ?? null,
    siteName: ts.employee.site?.name ?? null,
  }));
  const narrowed = filteredSheets.length !== sheets.length;

  const subtitle = [
    ruleSet?.name,
    ruleSet?.payFrequency && (FREQ_LABEL[ruleSet.payFrequency] ?? ruleSet.payFrequency),
    // lastDay, not endDate: endDate is exclusive, and printing it raw put a
    // second, later end date on the same screen as the title and the checklist.
    `Closes ${format(lastDay, "EEE d MMM")}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader pinned
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular">{label}</span>
            <Badge tone={payPeriodTone(payPeriod.status)}>
              {PAY_PERIOD_STATUS_LABEL[payPeriod.status]}
            </Badge>
          </span>
        }
        subtitle={subtitle}
        actions={
          <>
            <PayPeriodExport payPeriodId={payPeriod.id} label={label} sites={sites} />
            <PayPeriodDownload payPeriodId={payPeriod.id} label={label} />
            <PayPeriodActions
              payPeriodId={payPeriod.id}
              status={payPeriod.status}
              isReady={validation.isReady}
              isPast={isPast}
              adpConfigured={adpConfigured}
              payrollRun={payrollRun}
            />
          </>
        }
      />

      <Banner tone={banner.tone} title={banner.title} body={banner.body} />

      <Card title="Close Checklist" subtitle="Every step must clear before the period can lock.">
        <div className="flex flex-col">
          {checklist.map((c) => (
            <div
              key={c.label}
              className="flex items-center gap-3 py-2.5"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <span className="inline-flex flex-none">
                {c.done ? (
                  <CircleCheck className="h-[18px] w-[18px]" style={{ color: "var(--icon-success)" }} />
                ) : (
                  <CircleDashed className="h-[18px] w-[18px]" style={{ color: "var(--icon-secondary)" }} />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)" }}>
                  {c.label}
                </span>
                <span
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}
                >
                  {c.detail}
                </span>
              </span>
              <Badge tone={c.done ? "success" : "warning"} size="sm">
                {c.done ? "Clear" : "Blocking"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Period Totals"
        subtitle="Every timesheet in the period, before the site and department filters below."
      >
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
          {[
            { label: "Employees", value: String(validation.totalTimesheets) },
            { label: "Total Hours", value: (allMin / 60).toFixed(2) },
            { label: "Regular", value: (regMin / 60).toFixed(2) },
            { label: "Overtime", value: (otMin / 60).toFixed(2) },
            { label: "Double Time", value: (dtMin / 60).toFixed(2) },
            // Named, not dropped, because the four figures above have to add
            // up to the total — a gap with no label reads as an error in the
            // hours rather than as PTO and holiday pay.
            { label: "Other Pay Codes", value: (otherMin / 60).toFixed(2) },
            { label: "Approved", value: `${validation.approvedCount} of ${validation.totalTimesheets}` },
          ].map((kv) => (
            <div key={kv.label} className="flex min-w-0 flex-col gap-0.5">
              <span className="wms-overline">{kv.label}</span>
              <span
                className="tabular"
                style={{
                  font: "var(--weight-semibold) 16px/22px var(--font-sans)",
                  color: "var(--text-primary)",
                  overflowWrap: "anywhere",
                }}
              >
                {kv.value}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Approval Progress"
        subtitle="Where every timesheet in the period currently sits."
        padding={0}
      >
        {sheets.length === 0 ? (
          <EmptyState
            title="No timesheets yet"
            body="Nothing has been generated for this period. Timesheets appear as employees punch."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Stage</TH>
                <TH numeric>Timesheets</TH>
                <TH numeric>Share</TH>
                <TH>Waiting On</TH>
              </TR>
            </THead>
            <TBody>
              {STAGE_ORDER.map((stage) => {
                const n = stageCount(stage);
                return (
                  <TR key={stage}>
                    <TD>
                      <Badge tone={statusTone(stage)} size="sm">
                        {TIMESHEET_STATUS_LABEL[stage]}
                      </Badge>
                    </TD>
                    <TD numeric style={{ color: n === 0 ? "var(--text-tertiary)" : undefined }}>
                      {n}
                    </TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>
                      {((n / sheets.length) * 100).toFixed(1)}%
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{STAGE_OWNER[stage]}</TD>
                  </TR>
                );
              })}
            </TBody>
            <TFoot>
              <TR>
                <TD style={{ fontWeight: "var(--weight-semibold)" }}>Total</TD>
                <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                  {sheets.length}
                </TD>
                <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>100.0%</TD>
                <TD />
              </TR>
            </TFoot>
          </Table>
        )}
      </Card>

      <Card
        title="Timesheets"
        subtitle={
          narrowed
            ? `${filteredSheets.length} of ${sheets.length} timesheets match the filters`
            : `${sheets.length} timesheet${sheets.length === 1 ? "" : "s"} in this period`
        }
        actions={
          <PayPeriodDetailFilter
            payPeriodId={payPeriod.id}
            currentFilter={currentFilter}
            sites={sites}
            departments={departments}
            selectedSiteId={siteId}
            selectedDepartmentId={departmentId}
          />
        }
        padding={0}
      >
        <PayPeriodTimesheets
          timesheets={tileData}
          payPeriodId={payPeriod.id}
          filtered={Boolean(siteId || departmentId)}
        />
      </Card>
    </div>
  );
}
