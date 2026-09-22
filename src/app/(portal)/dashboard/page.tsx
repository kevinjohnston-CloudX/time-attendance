import { auth } from "@/lib/auth";
import {
  Badge,
  Card,
  LinkButton,
  PageHeader,
  exceptionTone,
  punchTone,
  leaveTone,
  statusTone,
} from "@/components/ui";
import { db } from "@/lib/db";
import Link from "next/link";
import { format, addDays } from "date-fns";
import { formatMinutes } from "@/lib/utils/duration";
import { parseUtcDate } from "@/lib/utils/date";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { OverviewPeriodFilter } from "@/components/dashboard/overview-period-filter";
import { TodayPunchActions } from "@/components/dashboard/today-punch-actions";
import { SubmitTimesheetButton } from "@/components/time/submit-timesheet-button";
import {
  getApprovalQueue,
  getExceptionsFeed,
  getPresence,
  getToday,
  getUpcoming,
} from "@/lib/dashboard/dashboard-data";
import {
  TIMESHEET_STATUS_LABEL,
  type PunchStateValue,
  type TimesheetStatusValue,
} from "@/lib/state-machines/labels";

/**
 * The dashboard, as the portal design lays it out.
 *
 * <p>Seven cards in a two-column grid rather than a row of stat tiles: Today,
 * Pay Period, Needs Your Approval, Exceptions, Team Presence, Coming Up, and
 * the period overview.
 *
 * <p>Which cards appear depends on what the viewer can do. An employee with no
 * team sees Today, Pay Period and Coming Up; the grid is `auto-fit`, so those
 * fill the width rather than leaving holes where the team cards would be.
 */

const PUNCH_STATE_LABEL: Record<string, string> = {
  WORK:  "Working",
  MEAL:  "Meal Break",
  BREAK: "On Break",
  OUT:   "Clocked Out",
};

const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PUNCH:    "Missing Punch",
  LONG_SHIFT:       "Long Shift",
  SHORT_BREAK:      "Short Break",
  MISSED_MEAL:      "Missed Meal",
  UNSCHEDULED_OT:   "Unscheduled OT",
  CONSECUTIVE_DAYS: "Consecutive Days",
  ABSENT:           "Absent",
  LATE_IN:          "Late In",
  EARLY_OUT:        "Early Out",
};

const LEAVE_STATUS_LABEL: Record<string, string> = {
  DRAFT:     "Draft",
  PENDING:   "Pending",
  APPROVED:  "Approved",
  REJECTED:  "Rejected",
  CANCELLED: "Cancelled",
  POSTED:    "Posted",
};

/** The card row the design uses: two up, one up when narrow. */
const CARD_GRID =
  "grid gap-4 items-stretch [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(340px,44%)),1fr))]";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ overviewPeriodId?: string }>;
}) {
  const session = await auth();
  const employeeId = session?.user?.employeeId ?? null;
  const tenantId = (session?.user as { tenantId?: string } | undefined)?.tenantId;
  const now = new Date();
  const year = now.getFullYear();
  const { overviewPeriodId } = (await searchParams) ?? {};

  const [payPeriod, allLeaveBalances, myLeaveRequests, me] = await Promise.all([
    tenantId
      ? db.payPeriod.findFirst({
          where: {
            tenantId,
            ruleSetId: { not: null },
            startDate: { lte: now },
            endDate:   { gt: now },
            status: "OPEN",
          },
          select: { id: true, tenantId: true, startDate: true, endDate: true, status: true },
        })
      : null,

    employeeId
      ? db.leaveBalance.findMany({
          where: { employeeId, accrualYear: year },
          include: { leaveType: { select: { name: true } } },
          orderBy: { leaveType: { name: "asc" } },
        })
      : [],

    // Approved reduces what is left; pending is shown but not deducted.
    employeeId
      ? db.leaveRequest.findMany({
          where: { employeeId, status: { in: ["APPROVED", "PENDING"] } },
          select: { leaveTypeId: true, durationMinutes: true, status: true },
        })
      : [],

    employeeId
      ? db.employee.findUnique({
          where: { id: employeeId },
          select: { site: { select: { name: true } } },
        })
      : null,
  ]);

  const currentTimesheet =
    payPeriod && employeeId
      ? await db.timesheet.findFirst({
          where: { employeeId, payPeriodId: payPeriod.id },
          include: { overtimeBuckets: true },
        })
      : null;

  // ── What this person is allowed to see ────────────────────────────────────
  const hasPayrollAccess = session?.user
    ? await userHasPermission(session.user, "PAY_PERIOD_MANAGE")
    : false;
  const canApproveTeam = session?.user
    ? await userHasPermission(session.user, "TIMESHEET_APPROVE_TEAM")
    : false;

  // ── The cards ─────────────────────────────────────────────────────────────
  const [today, approvals, exceptionsFeed, presence, upcoming] = await Promise.all([
    employeeId ? getToday(employeeId, now) : null,
    canApproveTeam && tenantId ? getApprovalQueue(employeeId, tenantId, hasPayrollAccess) : null,
    canApproveTeam && tenantId
      ? getExceptionsFeed(employeeId, tenantId, hasPayrollAccess, payPeriod?.id ?? null)
      : null,
    canApproveTeam && tenantId
      ? getPresence(tenantId, hasPayrollAccess ? null : employeeId)
      : null,
    tenantId
      ? getUpcoming(employeeId, tenantId, now, payPeriod ? parseUtcDate(payPeriod.endDate) : null)
      : [],
  ]);

  // ── Period overview (PAY_PERIOD_MANAGE only) ─────────────────────────────
  let overviewFilterOptions: { id: string; label: string }[] = [];
  let selectedOverviewPeriodId = payPeriod?.id ?? "";
  let exceptionCounts: { exceptionType: string; _count: { _all: number } }[] = [];
  let leaveStatusCounts: { status: string; _count: { _all: number } }[] = [];
  let timesheetStatusCounts: { status: string; _count: { _all: number } }[] = [];

  if (hasPayrollAccess && tenantId) {
    const [prevPP, nextPP] = await Promise.all([
      payPeriod
        ? db.payPeriod.findFirst({
            where: { tenantId, ruleSetId: { not: null }, endDate: { lt: payPeriod.startDate } },
            orderBy: { endDate: "desc" },
            select: { id: true, startDate: true, endDate: true },
          })
        : null,
      payPeriod
        ? db.payPeriod.findFirst({
            where: { tenantId, ruleSetId: { not: null }, startDate: { gt: payPeriod.endDate } },
            orderBy: { startDate: "asc" },
            select: { id: true, startDate: true, endDate: true },
          })
        : null,
    ]);

    type PeriodOption = { id: string; startDate: Date; endDate: Date; label: string };
    const allPeriods: PeriodOption[] = [
      prevPP && {
        ...prevPP,
        label: `${format(parseUtcDate(prevPP.startDate), "MMM d")} – ${format(addDays(parseUtcDate(prevPP.endDate), -1), "MMM d")} (Previous)`,
      },
      payPeriod && {
        id: payPeriod.id,
        startDate: payPeriod.startDate,
        endDate: payPeriod.endDate,
        label: `${format(parseUtcDate(payPeriod.startDate), "MMM d")} – ${format(addDays(parseUtcDate(payPeriod.endDate), -1), "MMM d")} (Current)`,
      },
      nextPP && {
        ...nextPP,
        label: `${format(parseUtcDate(nextPP.startDate), "MMM d")} – ${format(addDays(parseUtcDate(nextPP.endDate), -1), "MMM d")} (Next)`,
      },
    ].filter(Boolean) as PeriodOption[];

    overviewFilterOptions = allPeriods.map(({ id, label }) => ({ id, label }));

    const selectedPeriod =
      allPeriods.find((p) => p.id === overviewPeriodId) ??
      allPeriods.find((p) => p.id === payPeriod?.id) ??
      allPeriods[0];

    selectedOverviewPeriodId = selectedPeriod?.id ?? "";

    if (selectedPeriod) {
      [exceptionCounts, leaveStatusCounts, timesheetStatusCounts] = await Promise.all([
        db.$queryRaw<{ exceptionType: string; cnt: bigint }[]>`
          SELECT e."exceptionType", COUNT(*)::int AS cnt
          FROM "exceptions" e
          JOIN "timesheets" ts  ON ts.id  = e."timesheetId"
          JOIN "pay_periods" pp ON pp.id  = ts."payPeriodId"
          JOIN "employees"  emp ON emp.id = ts."employeeId"
          WHERE e."resolvedAt"   IS NULL
            AND pp."tenantId"    = ${tenantId}
            AND pp."startDate"   = ${selectedPeriod.startDate}
            AND emp."tenantId"   = ${tenantId}
            AND e."exceptionType" != 'SCAN_DISCREPANCY'
          GROUP BY e."exceptionType"
        `.then((rows) =>
          rows.map((r) => ({ exceptionType: r.exceptionType, _count: { _all: Number(r.cnt) } }))
        ).catch(() => []),
        db.leaveRequest.groupBy({
          by: ["status"],
          where: {
            employee: { tenantId },
            startDate: { gte: selectedPeriod.startDate, lte: selectedPeriod.endDate },
          },
          _count: { _all: true },
        }),
        db.timesheet.groupBy({
          by: ["status"],
          where: {
            payPeriod: { tenantId, startDate: selectedPeriod.startDate },
            employee:  { tenantId },
          },
          _count: { _all: true },
        }),
      ]);
    }
  }

  // ── Header line ───────────────────────────────────────────────────────────
  const periodLabel = payPeriod
    ? `${format(parseUtcDate(payPeriod.startDate), "MMM d")} – ${format(addDays(parseUtcDate(payPeriod.endDate), -1), "MMM d")}`
    : null;
  const daysLeft = payPeriod
    ? Math.ceil(
        (parseUtcDate(payPeriod.endDate).getTime() -
          new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
          86_400_000,
      )
    : 0;

  const subtitle = [
    format(now, "EEEE, d MMMM yyyy"),
    me?.site?.name,
    periodLabel && `Pay period ${periodLabel}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // ── Pay period hours ──────────────────────────────────────────────────────
  const bucketMap = Object.fromEntries(
    (currentTimesheet?.overtimeBuckets ?? []).map((b) => [b.bucket, b.totalMinutes])
  );
  const regMin = bucketMap["REG"] ?? 0;
  const otMin  = bucketMap["OT"]  ?? 0;
  const dtMin  = bucketMap["DT"]  ?? 0;
  const ptoMin = bucketMap["PTO"] ?? 0;

  /** How far through the period we are — the width of the bar under the stats. */
  const elapsedPct = payPeriod
    ? Math.min(
        100,
        Math.max(
          0,
          ((now.getTime() - parseUtcDate(payPeriod.startDate).getTime()) /
            (parseUtcDate(payPeriod.endDate).getTime() -
              parseUtcDate(payPeriod.startDate).getTime())) *
            100,
        ),
      )
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboard"
        subtitle={subtitle}
        actions={
          employeeId ? (
            <LinkButton href="/time/punch" hierarchy="secondary">
              Punch Clock
            </LinkButton>
          ) : undefined
        }
      />

      {/* ── Row 1: your day, and what is waiting on you ── */}
      <div className={CARD_GRID}>
        {today && (
          <Card
            title="Today"
            subtitle={
              today.shift
                ? `${format(now, "EEE d MMM")} · Shift ${today.shift.start} – ${today.shift.end}`
                : format(now, "EEE d MMM")
            }
          >
            <div className="flex flex-col gap-3.5">
              <div className="flex items-baseline gap-2.5">
                <span
                  className="tabular"
                  style={{
                    font: "var(--weight-bold) 40px/44px var(--font-sans)",
                    letterSpacing: "-0.03em",
                    color: "var(--text-primary)",
                  }}
                >
                  {(today.workedMinutes / 60).toFixed(2)}
                </span>
                <span style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                  hours today
                </span>
                <span className="ml-auto">
                  <Badge tone={punchTone(today.state)} dot>
                    {PUNCH_STATE_LABEL[today.state] ?? today.state}
                  </Badge>
                </span>
              </div>

              <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                {today.since}
              </p>

              <TodayPunchActions state={today.state as PunchStateValue} />

              {today.punches.length > 0 && (
                <div
                  className="flex flex-col gap-1.5 pt-2.5"
                  style={{ borderTop: "1px solid var(--stroke-divider)" }}
                >
                  {today.punches.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2.5"
                      style={{ font: "var(--type-body2)" }}
                    >
                      <span className="tabular w-[74px]" style={{ color: "var(--text-secondary)" }}>
                        {format(p.time, "hh:mm a")}
                      </span>
                      <span className="flex-1">{p.label}</span>
                      <span style={{ color: "var(--text-tertiary)" }}>{p.source}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {employeeId && (
          <Card
            title="Pay Period"
            subtitle={
              periodLabel
                ? `${periodLabel} · ${daysLeft > 0 ? `Closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "Closes today"}`
                : "No active period"
            }
          >
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Regular", min: regMin },
                  { label: "Overtime", min: otMin },
                  { label: "PTO", min: ptoMin },
                ].map((s) => (
                  <div key={s.label} className="flex flex-col gap-0.5">
                    <span className="wms-overline">{s.label}</span>
                    <span
                      className="tabular"
                      style={{
                        font: "var(--weight-semibold) 20px/26px var(--font-sans)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {(s.min / 60).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Time elapsed in the period, not hours approved. The two read
                  the same at a glance, so this bar means one of them only. */}
              <div
                className="h-1.5 overflow-hidden rounded-full"
                style={{ background: "var(--ta-track)" }}
                role="presentation"
              >
                <div
                  style={{ width: `${elapsedPct}%`, height: "100%", background: "var(--fill-accent)" }}
                />
              </div>

              {dtMin > 0 && (
                <p
                  className="tabular"
                  style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}
                >
                  {formatMinutes(dtMin)} double time
                </p>
              )}

              {allLeaveBalances.length > 0 && (
                <div
                  className="flex flex-col gap-2 pt-3"
                  style={{ borderTop: "1px solid var(--stroke-divider)" }}
                >
                  <span className="wms-overline">PTO Balances</span>
                  {allLeaveBalances.map((b) => {
                    const approved = myLeaveRequests
                      .filter((r) => r.leaveTypeId === b.leaveTypeId && r.status === "APPROVED")
                      .reduce((sum, r) => sum + r.durationMinutes, 0);
                    const pending = myLeaveRequests
                      .filter((r) => r.leaveTypeId === b.leaveTypeId && r.status === "PENDING")
                      .reduce((sum, r) => sum + r.durationMinutes, 0);
                    const remaining = b.balanceMinutes - approved;
                    const note =
                      pending > 0
                        ? `${(pending / 60).toFixed(1)} h pending`
                        : approved > 0
                          ? `${(approved / 60).toFixed(1)} h booked`
                          : "";
                    return (
                      <div
                        key={b.id}
                        className="flex items-center gap-2.5"
                        style={{ font: "var(--type-body1)" }}
                      >
                        <span className="flex-1">{b.leaveType.name}</span>
                        <span
                          className="tabular"
                          style={{
                            fontWeight: "var(--weight-medium)",
                            color: remaining < 0 ? "var(--text-error)" : "var(--text-primary)",
                          }}
                        >
                          {(remaining / 60).toFixed(1)} h
                        </span>
                        <span style={{ color: "var(--text-tertiary)", font: "var(--type-body2)" }}>
                          {note}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {currentTimesheet && (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 pt-3"
                  style={{ borderTop: "1px solid var(--stroke-divider)" }}
                >
                  <Badge tone={statusTone(currentTimesheet.status)} size="sm">
                    {TIMESHEET_STATUS_LABEL[currentTimesheet.status as TimesheetStatusValue]}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <LinkButton
                      href={`/time/timesheet/${currentTimesheet.id}`}
                      hierarchy="secondary"
                      size="sm"
                    >
                      Open Timesheet
                    </LinkButton>
                    {currentTimesheet.status === "OPEN" && (
                      <SubmitTimesheetButton timesheetId={currentTimesheet.id} />
                    )}
                  </div>
                </div>
              )}

              {currentTimesheet?.status === "OPEN" && currentTimesheet.rejectionNote && (
                <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>
                  Returned: {currentTimesheet.rejectionNote}
                </p>
              )}
            </div>
          </Card>
        )}

        {approvals && (
          <Card
            title="Needs Your Approval"
            subtitle={`${approvals.total} timesheet${approvals.total === 1 ? "" : "s"} · ${approvals.leaveCount} leave request${approvals.leaveCount === 1 ? "" : "s"}`}
          >
            <div className="flex flex-col">
              {approvals.rows.length === 0 ? (
                <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
                  Nothing waiting on you.
                </p>
              ) : (
                approvals.rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2.5 py-2"
                    style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                  >
                    <span className="min-w-0 flex-1 truncate" style={{ font: "var(--type-body1)" }}>
                      {r.name}
                    </span>
                    <span
                      className="tabular"
                      style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                    >
                      {r.hours} h
                    </span>
                    <span
                      className="w-24 text-right"
                      style={{
                        font: "var(--type-body2)",
                        color: r.tone ? "var(--text-warning)" : "var(--text-tertiary)",
                      }}
                    >
                      {r.kind}
                    </span>
                  </div>
                ))
              )}
              <div className="pt-2.5">
                <LinkButton href="/supervisor/timesheets" hierarchy="secondary" size="sm">
                  Review All
                </LinkButton>
              </div>
            </div>
          </Card>
        )}

        {exceptionsFeed && (
          <Card title="Exceptions" subtitle="Unresolved this period">
            <div className="flex flex-col">
              {exceptionsFeed.rows.length === 0 ? (
                <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
                  Every timecard in range is clean.
                </p>
              ) : (
                exceptionsFeed.rows.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2.5 py-2"
                    style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                  >
                    <span className="min-w-0 flex-1 truncate" style={{ font: "var(--type-body1)" }}>
                      {e.name}
                    </span>
                    <span
                      className="tabular"
                      style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                    >
                      {format(e.date, "EEE MMM d")}
                    </span>
                    <Badge tone={exceptionTone(e.type)} size="sm">
                      {EXCEPTION_LABEL[e.type] ?? e.type}
                    </Badge>
                  </div>
                ))
              )}
              <div className="pt-2.5">
                <LinkButton href="/supervisor/exceptions" hierarchy="secondary" size="sm">
                  Open Exceptions
                </LinkButton>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* ── Row 2: the floor right now, and what is coming ── */}
      {(presence || upcoming.length > 0) && (
        <div className={CARD_GRID}>
          {presence && (
            <Card
              title="Team Presence"
              subtitle={`Live · ${format(now, "d MMM HH:mm")}${me?.site?.name ? ` · ${me.site.name}` : ""}`}
            >
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(126px,1fr))]">
                  {[
                    { label: "On the clock", value: presence.onClock, bg: "var(--surface-success)", color: "var(--text-success)" },
                    { label: "On meal", value: presence.onMeal, bg: "var(--surface-warning)", color: "var(--text-warning)" },
                    { label: "Not in", value: presence.notIn, bg: "var(--surface-card)", color: "var(--text-primary)" },
                    { label: "On leave", value: presence.onLeave, bg: "var(--surface-info)", color: "var(--text-accent)" },
                  ].map((p) => (
                    <div
                      key={p.label}
                      className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5"
                      style={{ border: "1px solid var(--stroke-divider)", background: p.bg }}
                    >
                      <span className="wms-overline">{p.label}</span>
                      <span
                        className="tabular"
                        style={{
                          font: "var(--weight-semibold) 22px/28px var(--font-sans)",
                          color: p.color,
                        }}
                      >
                        {p.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col">
                  {presence.byDept.map((d) => {
                    const inPct = d.total ? (d.inCount / d.total) * 100 : 0;
                    const mealPct = d.total ? (d.mealCount / d.total) * 100 : 0;
                    return (
                      <div
                        key={d.dept}
                        className="flex items-center gap-3 py-2"
                        style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                      >
                        <span
                          className="w-[82px] flex-none truncate"
                          style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)" }}
                          title={d.dept}
                        >
                          {d.dept}
                        </span>
                        <div
                          className="flex h-2 flex-1 overflow-hidden rounded-full"
                          style={{ background: "var(--ta-track)" }}
                        >
                          <div style={{ width: `${inPct}%`, background: "var(--fill-success)" }} />
                          <div style={{ width: `${mealPct}%`, background: "var(--fill-warning)" }} />
                        </div>
                        <span
                          className="tabular flex-none whitespace-nowrap text-right"
                          style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                        >
                          {d.inCount} / {d.total} in
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div
                  className="flex flex-wrap items-center gap-4"
                  style={{ font: "var(--type-caption1)", color: "var(--text-secondary)" }}
                >
                  {[
                    { label: "On the clock", bg: "var(--fill-success)" },
                    { label: "On meal", bg: "var(--fill-warning)" },
                    { label: "Not in", bg: "var(--ta-track)" },
                  ].map((l) => (
                    <span key={l.label} className="inline-flex items-center gap-1.5">
                      <span style={{ width: 10, height: 8, borderRadius: 2, background: l.bg }} />
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {upcoming.length > 0 && (
            <Card title="Coming Up" subtitle="Next 30 days">
              <div className="flex flex-col">
                {upcoming.map((u) => (
                  <div
                    key={u.key}
                    className="flex items-center gap-3 py-2"
                    style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                  >
                    <span
                      className="tabular w-[66px] flex-none"
                      style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                    >
                      {format(u.date, "MMM d")}
                    </span>
                    <span
                      className="min-w-0 flex-1"
                      style={{ font: "var(--type-body1)", textWrap: "pretty" }}
                    >
                      {u.what}
                    </span>
                    <Badge tone={u.tone} size="sm">
                      {u.kind}
                    </Badge>
                  </div>
                ))}
                <div className="flex gap-2 pt-2.5">
                  <LinkButton href="/leave" hierarchy="secondary" size="sm">
                    My Leave
                  </LinkButton>
                  {canApproveTeam && (
                    <LinkButton href="/supervisor/leave" hierarchy="tertiary" size="sm">
                      Team Calendar
                    </LinkButton>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Period overview ── */}
      {hasPayrollAccess && (
        <Card
          title="Period Overview"
          subtitle="Exceptions, leave and timesheet status for the selected period"
          actions={
            overviewFilterOptions.length > 0 ? (
              <OverviewPeriodFilter
                options={overviewFilterOptions}
                selectedId={selectedOverviewPeriodId}
              />
            ) : undefined
          }
        >
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
            <OverviewGroup title="Open Exceptions" empty="No open exceptions" count={exceptionCounts.length}>
              {exceptionCounts.map((ec) => {
                const params = new URLSearchParams({ exceptionType: ec.exceptionType });
                if (selectedOverviewPeriodId) params.set("payPeriodId", selectedOverviewPeriodId);
                return (
                  <Link
                    key={ec.exceptionType}
                    href={`/supervisor/exceptions?${params.toString()}`}
                    className="ta-hub-card min-w-[104px] rounded-lg p-3"
                    style={{
                      border: "1px solid var(--stroke-divider)",
                      background: "var(--surface-secondary)",
                    }}
                  >
                    <Badge tone={exceptionTone(ec.exceptionType)} size="sm">
                      {EXCEPTION_LABEL[ec.exceptionType] ?? ec.exceptionType}
                    </Badge>
                    <p
                      className="tabular mt-2"
                      style={{ margin: 0, font: "var(--type-h2)", color: "var(--text-primary)" }}
                    >
                      {ec._count._all}
                    </p>
                  </Link>
                );
              })}
            </OverviewGroup>

            <OverviewGroup title="Time-Off Requests" empty="No requests" count={leaveStatusCounts.length}>
              {leaveStatusCounts.map((lc) => {
                const href =
                  lc.status === "PENDING"
                    ? "/supervisor/leave?tab=pending"
                    : lc.status === "APPROVED"
                      ? "/supervisor/leave?tab=upcoming"
                      : null;
                const inner = (
                  <>
                    <Badge tone={leaveTone(lc.status)} size="sm">
                      {LEAVE_STATUS_LABEL[lc.status] ?? lc.status}
                    </Badge>
                    <p
                      className="tabular mt-2"
                      style={{ margin: 0, font: "var(--type-h2)", color: "var(--text-primary)" }}
                    >
                      {lc._count._all}
                    </p>
                  </>
                );
                return href ? (
                  <Link
                    key={lc.status}
                    href={href}
                    className="ta-hub-card min-w-[104px] rounded-lg p-3"
                    style={{
                      border: "1px solid var(--stroke-divider)",
                      background: "var(--surface-secondary)",
                    }}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div
                    key={lc.status}
                    className="min-w-[104px] rounded-lg p-3"
                    style={{
                      border: "1px solid var(--stroke-divider)",
                      background: "var(--surface-secondary)",
                    }}
                  >
                    {inner}
                  </div>
                );
              })}
            </OverviewGroup>

            <OverviewGroup
              title="Timesheets"
              empty="No timesheets in open pay periods"
              count={timesheetStatusCounts.length}
            >
              {timesheetStatusCounts.map((tc) => (
                <div
                  key={tc.status}
                  className="min-w-[104px] rounded-lg p-3"
                  style={{
                    border: "1px solid var(--stroke-divider)",
                    background: "var(--surface-secondary)",
                  }}
                >
                  <Badge tone={statusTone(tc.status)} size="sm">
                    {TIMESHEET_STATUS_LABEL[tc.status as TimesheetStatusValue] ?? tc.status}
                  </Badge>
                  <p
                    className="tabular mt-2"
                    style={{ margin: 0, font: "var(--type-h2)", color: "var(--text-primary)" }}
                  >
                    {tc._count._all}
                  </p>
                </div>
              ))}
            </OverviewGroup>
          </div>
        </Card>
      )}
    </div>
  );
}

/** One labelled group of count tiles inside the period overview. */
function OverviewGroup({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="wms-overline">{title}</span>
      {count === 0 ? (
        <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">{children}</div>
      )}
    </div>
  );
}
