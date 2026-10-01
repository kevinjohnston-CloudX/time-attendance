import { redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { format } from "date-fns";
import type { PayFrequency } from "@prisma/client";
import { CalendarRange, Check, CircleAlert, CircleCheck, Clock, Files } from "lucide-react";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { getPayPeriods, getPayPeriodDetail } from "@/actions/pay-period.actions";
import { getAdpConfig } from "@/lib/integrations/adp/client";
import { dayKey, FREQ_LABEL, periodLastDay, periodRange } from "@/lib/pay-period-display";
import { parseUtcDate } from "@/lib/utils/date";
import { Badge, LinkButton, type BadgeTone } from "@/components/ui";
import { PayPeriodActions } from "@/components/payroll/pay-period-actions";
import { PayPeriodDownload } from "@/components/payroll/pay-period-download";
import { PayPeriodTimesheets, type TimesheetRow } from "@/components/payroll/pay-period-timesheets";
import { matchesShow, parseShow, type TimesheetShow } from "@/components/payroll/pay-period-show";
import { PayPeriodsShell } from "@/components/payroll/pay-periods-shell";
import { PayPeriodsRail, type RailPeriod, type RailScope, type RailStatus } from "@/components/payroll/pay-periods-rail";

/**
 * Pay Periods, from the page handoff: the period list on the left, grouped by
 * rule set, and on the right the period itself. Its title and close actions
 * pinned at the top, then three counts and the hours, where the close stands,
 * and every timesheet.
 *
 * <p>The close summary and the hours are not in the handoff's picture and stay
 * anyway, drawn in its language. There are no approval steps: a timesheet is
 * open until the period is locked, and unresolved exceptions are something to
 * review before locking, not something that stops it.
 *
 * <p>Every date here goes through periodLastDay, since a stored end date is
 * either the day after the last day or, for older monthly and semi-monthly
 * periods, the last day itself.
 */

const COMPANY_NAME = "Company default";
const STATUS_LABEL = { OPEN: "Open", READY: "Ready for Lock", LOCKED: "Locked" } as const;
const STATUS_TONE: Record<keyof typeof STATUS_LABEL, BadgeTone> = { OPEN: "info", READY: "warning", LOCKED: "success" };
const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };

const STAGES: { key: "open" | "locked"; label: string; owner: string; color: string }[] = [
  { key: "open", label: "Open", owner: "Editable until the period is locked", color: "var(--fill-accent)" },
  { key: "locked", label: "Locked", owner: "Final", color: "var(--icon-success)" },
];

const n = (v: number) => v.toLocaleString("en-US");
const hoursOf = (minutes: number) => (minutes / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PayPeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; filter?: string; status?: string; month?: string; siteId?: string; departmentId?: string; show?: string }>;
}) {
  const { id: selectedId, filter, status, month, siteId, departmentId, show: showParam } = await searchParams;
  const show = parseShow(showParam);
  const scope: RailScope = filter === "current" || filter === "ytd" ? filter : "all";
  const statusFilter: RailStatus = status === "open" || status === "locked" ? status : "all";
  const monthParam = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : null;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/dashboard");
  const canRunPayroll = await userHasPermission(session.user, "PAYROLL_RUN");

  const result = await getPayPeriods();
  if (!result.success) redirect("/dashboard");
  const all = result.data;

  // The company every period here belongs to (getPayPeriods is scoped to it),
  // for its own pay frequency and for the site and department lists.
  const tenantId = all[0]?.tenantId ?? session.user.tenantId ?? null;
  const tenant = tenantId ? await db.tenant.findUnique({ where: { id: tenantId }, select: { payFrequency: true } }) : null;
  const freqOf = (pp: (typeof all)[number]): PayFrequency => pp.ruleSet?.payFrequency ?? tenant?.payFrequency ?? "BIWEEKLY";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dayKey(today);

  const rail: RailPeriod[] = all.map((pp) => {
    const last = periodLastDay(pp.endDate, freqOf(pp));
    return {
      id: pp.id,
      label: periodRange(pp.startDate, last),
      startKey: dayKey(parseUtcDate(pp.startDate)),
      lastKey: dayKey(last),
      status: pp.status,
      groupKey: pp.ruleSetId ?? "company",
      groupName: pp.ruleSet?.name ?? COMPANY_NAME,
      freqLabel: FREQ_LABEL[freqOf(pp)],
      total: pp.timesheets.length,
    };
  });

  // No period picked: open today's, the one ending soonest when rule sets overlap.
  if (!selectedId) {
    const current = rail
      .filter((p) => p.startKey <= todayKey && todayKey <= p.lastKey)
      .sort((a, b) => a.lastKey.localeCompare(b.lastKey))[0];
    if (current) {
      const p = new URLSearchParams({ id: current.id, filter: "current" });
      if (siteId) p.set("siteId", siteId);
      if (departmentId) p.set("departmentId", departmentId);
      redirect(`/payroll/pay-periods?${p}`);
    }
  }

  const keep: Record<string, string> = {};
  if (siteId) keep.siteId = siteId;
  if (departmentId) keep.departmentId = departmentId;

  const railNode = (
    <PayPeriodsRail
      periods={rail}
      selectedId={selectedId}
      scope={scope}
      status={statusFilter}
      month={monthParam}
      todayKey={todayKey}
      keep={keep}
    />
  );

  const detailResult = selectedId ? await getPayPeriodDetail({ payPeriodId: selectedId }) : null;
  const detail = detailResult?.success ? detailResult.data : null;

  if (!detail) {
    return (
      <PayPeriodsShell rail={railNode} header={null}>
        <section className="flex flex-col items-center gap-2.5 px-6 py-16 text-center" style={PANEL}>
          <CalendarRange className="h-8 w-8" aria-hidden style={{ color: "var(--icon-disabled)" }} />
          <span style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)", color: "var(--text-primary)" }}>
            {selectedId ? "That pay period was not found" : "No pay period open"}
          </span>
          <span style={{ maxWidth: 380, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
            Pick one on the left to see its hours, what is left to review before its close and every timesheet in it.
          </span>
        </section>
      </PayPeriodsShell>
    );
  }

  const { payPeriod, validation } = detail;
  const row = all.find((pp) => pp.id === payPeriod.id)!;
  const freq = freqOf(row);
  const lastDay = periodLastDay(payPeriod.endDate, freq);
  const label = periodRange(payPeriod.startDate, lastDay);
  const lastDayText = format(lastDay, "EEE, MMM d");
  const isPast = dayKey(lastDay) < todayKey;

  const [sites, departments, payrollRun] = await Promise.all([
    db.site.findMany({ where: { isActive: true, tenantId: payPeriod.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({
      where: { isActive: true, tenantId: payPeriod.tenantId, ...(siteId ? { sites: { some: { siteId } } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.payrollRun.findUnique({
      where: { payPeriodId: payPeriod.id },
      select: { id: true, exportedAt: true, pushedCount: true, skippedCount: true, errorCount: true },
    }),
  ]);

  const header = (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
        <h2 className="tabular m-0" style={{ font: "var(--weight-bold) 30px/36px var(--font-sans)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          {label}
        </h2>
        <span className="flex flex-wrap items-center gap-2.5">
          <Badge tone={STATUS_TONE[payPeriod.status]} dot>
            {STATUS_LABEL[payPeriod.status]}
          </Badge>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            {[row.ruleSet?.name ?? COMPANY_NAME, FREQ_LABEL[freq], `Last day ${lastDayText}`].join(" · ")}
          </span>
        </span>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <PayPeriodActions
          payPeriodId={payPeriod.id}
          label={label}
          status={payPeriod.status}
          isPast={isPast}
          canRunPayroll={canRunPayroll}
          exceptions={validation.unresolvedExceptions}
          adpConfigured={getAdpConfig() !== null}
          payrollRun={payrollRun}
          leading={<PayPeriodDownload payPeriodId={payPeriod.id} label={label} />}
        />
      </div>
    </div>
  );

  return (
    <PayPeriodsShell rail={railNode} header={header}>
      <PeriodBody
        detail={detail}
        freqLabel={FREQ_LABEL[freq]}
        lastDayText={lastDayText}
        isPast={isPast}
        scope={scope}
        statusFilter={statusFilter}
        monthParam={monthParam}
        sites={sites}
        departments={departments}
        siteId={siteId}
        departmentId={departmentId}
        show={show}
      />
    </PayPeriodsShell>
  );
}

// ─── The period ───────────────────────────────────────────────────────────────

type Detail = Extract<Awaited<ReturnType<typeof getPayPeriodDetail>>, { success: true }>["data"];

function Kpi({ icon, label, tile, value, valueColor, sub, bar, children }: {
  icon: ReactNode;
  label: string;
  tile: { bg: string; fg: string };
  value: string;
  valueColor?: string;
  sub: string;
  bar: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 px-5 py-[18px]" style={PANEL}>
      <span className="flex items-center gap-2 whitespace-nowrap" style={{ font: "var(--weight-medium) 13px/18px var(--font-sans)", color: "var(--text-secondary)" }}>
        <span className="grid h-7 w-7 flex-none place-items-center" style={{ borderRadius: 8, background: tile.bg, color: tile.fg }}>
          {icon}
        </span>
        {label}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="tabular" style={{ font: "var(--weight-bold) 34px/38px var(--font-sans)", letterSpacing: "-0.03em", color: valueColor ?? "var(--text-primary)" }}>
          {value}
        </span>
        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>{sub}</span>
      </span>
      <span className="mt-auto flex h-[5px] overflow-hidden rounded-full" style={{ background: "var(--ta-track)", gap: 2 }}>
        {bar}
      </span>
      {children}
    </div>
  );
}

function PeriodBody({
  detail,
  freqLabel,
  lastDayText,
  isPast,
  scope,
  statusFilter,
  monthParam,
  sites,
  departments,
  siteId,
  departmentId,
  show,
}: {
  detail: Detail;
  freqLabel: string;
  lastDayText: string;
  isPast: boolean;
  scope: RailScope;
  statusFilter: RailStatus;
  monthParam: string | null;
  sites: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  siteId?: string;
  departmentId?: string;
  show: TimesheetShow | "";
}) {
  const { payPeriod, validation } = detail;
  const sheets = payPeriod.timesheets;
  const T = sheets.length;

  // ── Open and locked, counted once ─────────────────────────────────────────
  const locked = sheets.filter((ts) => ts.status === "LOCKED").length;
  const open = T - locked;
  const stageCount = (key: "open" | "locked") => (key === "locked" ? locked : open);
  const sheetsWithExceptions = sheets.filter((ts) => ts.exceptions.length > 0).length;
  const exceptions = validation.unresolvedExceptions;
  const isLocked = payPeriod.status === "LOCKED";

  // ── Hours, from the buckets the overtime engine wrote ─────────────────────
  let regMin = 0, otMin = 0, dtMin = 0, allMin = 0;
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

  // ── Links the summary hands you to ───────────────────────────────────────
  const base = new URLSearchParams({ id: payPeriod.id });
  if (monthParam) base.set("month", monthParam);
  else if (scope !== "all") base.set("filter", scope);
  if (statusFilter !== "all") base.set("status", statusFilter);
  const baseQuery = base.toString();
  const showHref = (v: TimesheetShow) => {
    const p = new URLSearchParams(base);
    if (siteId) p.set("siteId", siteId);
    if (departmentId) p.set("departmentId", departmentId);
    p.set("show", v);
    return `/payroll/pay-periods?${p}#timesheets`;
  };
  const exceptionsHref = `/supervisor/exceptions?payPeriodId=${encodeURIComponent(payPeriod.id)}`;
  const see = (v: TimesheetShow, count: number) => ({ href: showHref(v), text: `See ${count === 1 ? "this timesheet" : `these ${n(count)} timesheets`}` });

  // ── The close, as three steps, from the timesheets loaded above ──────────
  // Only Locked is required; the other two are what to check before it.
  const exceptionsDetail = `${n(exceptions)} ${exceptions === 1 ? "problem" : "problems"}, like a missed punch, still ${exceptions === 1 ? "needs" : "need"} a look on ${n(sheetsWithExceptions)} ${sheetsWithExceptions === 1 ? "timesheet" : "timesheets"}.`;
  const steps: { label: string; caption: string; detail: string; done: boolean; action?: { href: string; text: string } }[] = [
    {
      label: "Period ended",
      caption: isPast ? `Ended ${lastDayText}` : `Ends ${lastDayText}`,
      detail: isPast ? `The last day was ${lastDayText}.` : `Still taking punches until ${lastDayText}.`,
      done: isPast,
    },
    {
      label: "Exceptions reviewed",
      caption: exceptions === 0 ? "Done" : `${n(exceptions)} to review`,
      detail: exceptionsDetail,
      done: exceptions === 0,
      action: exceptions > 0 ? { href: exceptionsHref, text: "Review exceptions" } : undefined,
    },
    {
      label: "Locked",
      caption: isLocked ? "Done" : `${n(open)} open`,
      detail: isLocked
        ? "Every timesheet in the period is locked."
        : `${n(open)} ${open === 1 ? "timesheet is" : "timesheets are"} still open. Locking the period locks every one of them.`,
      done: isLocked,
      action: !isLocked && open > 0 ? see("open", open) : undefined,
    },
  ];
  // The next thing to look at: the first open step somebody can act on from
  // here, else the first open one (the period not having ended).
  const pendingSteps = steps.filter((s) => !s.done);
  const next = pendingSteps.find((s) => s.action) ?? pendingSteps[0] ?? null;
  const standing: { tone: "success" | "warning" | "info"; title: string; text: string } = isLocked
    ? { tone: "success", title: "Locked", text: "This period is closed. Its hours, time off balances and approved leave are final." }
    : exceptions > 0
      ? { tone: "warning", title: "Exceptions to review", text: `${exceptionsDetail} Locking does not wait for them.` }
      : !isPast
        ? { tone: "info", title: "Still taking punches", text: `The last day is ${lastDayText}. Lock the period at the top once it has ended.` }
        : { tone: "success", title: "Ready to lock", text: "Nothing is left to review. Lock the period at the top to make its hours final and post time off, then export it to ADP." };
  const standTile =
    standing.tone === "warning"
      ? { bg: "var(--surface-warning)", fg: "var(--icon-warning)" }
      : standing.tone === "success"
        ? { bg: "var(--surface-success)", fg: "var(--icon-success)" }
        : { bg: "var(--surface-info)", fg: "var(--icon-accent)" };
  const liveStages = STAGES.filter((st) => stageCount(st.key) > 0);

  // ── The timesheets, narrowed the way the link asks ────────────────────────
  const rows: TimesheetRow[] = sheets
    .filter((ts) => (!siteId || ts.employee.siteId === siteId) && (!departmentId || ts.employee.departmentId === departmentId))
    .filter((ts) => !show || matchesShow(show, ts.status, ts.exceptions.length))
    .map((ts) => ({
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

  const hoursBar = allMin
    ? [
        { min: regMin, color: "var(--fill-accent)" },
        { min: otMin, color: "var(--fill-warning)" },
        { min: dtMin, color: "var(--fill-error)" },
        { min: otherMin, color: "var(--icon-tertiary)" },
      ].filter((s) => s.min > 0)
    : [];

  return (
    <>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        <Kpi
          icon={<Files className="h-4 w-4" aria-hidden />}
          label="Total timesheets"
          tile={{ bg: "var(--ta-well)", fg: "var(--icon-tertiary)" }}
          value={n(T)}
          sub={`${freqLabel.toLowerCase()} period`}
          bar={<span className="block h-full w-full rounded-full" style={{ background: "var(--ta-ring-strong)" }} />}
        />
        <Kpi
          icon={<CircleCheck className="h-4 w-4" aria-hidden />}
          label="Locked"
          tile={{ bg: "var(--surface-success)", fg: "var(--icon-success)" }}
          value={n(locked)}
          valueColor={locked ? "var(--text-success)" : undefined}
          sub={T ? `${n(open)} open` : "no timesheets"}
          bar={<span className="block h-full rounded-full" style={{ width: `${T ? (locked / T) * 100 : 0}%`, background: "var(--fill-success)" }} />}
        />
        <Kpi
          icon={<CircleAlert className="h-4 w-4" aria-hidden />}
          label="Exceptions"
          tile={exceptions ? { bg: "var(--surface-warning)", fg: "var(--icon-warning)" } : { bg: "var(--ta-well)", fg: "var(--icon-tertiary)" }}
          value={n(exceptions)}
          valueColor={exceptions ? "var(--text-warning)" : undefined}
          sub={`on ${n(sheetsWithExceptions)} ${sheetsWithExceptions === 1 ? "timesheet" : "timesheets"}`}
          bar={<span className="block h-full rounded-full" style={{ width: `${T ? Math.min(100, (sheetsWithExceptions / T) * 100) : 0}%`, background: "var(--fill-warning)" }} />}
        />
        <Kpi
          icon={<Clock className="h-4 w-4" aria-hidden />}
          label="Total hours"
          tile={{ bg: "var(--surface-info)", fg: "var(--icon-accent)" }}
          value={hoursOf(allMin)}
          sub="hours"
          bar={hoursBar.map((s, i) => (
            <span key={i} className="block h-full" style={{ width: `${(s.min / allMin) * 100}%`, background: s.color }} />
          ))}
        >
          {/* Named, not dropped, so the figures add up to the total: other
              pay codes are PTO, holiday and the like. */}
          <span className="tabular flex flex-wrap gap-x-3 gap-y-1" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            <span>Regular <b style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{hoursOf(regMin)}</b></span>
            <span>Overtime <b style={{ fontWeight: 600, color: otMin ? "var(--text-warning)" : "var(--text-secondary)" }}>{hoursOf(otMin)}</b></span>
            <span>Double <b style={{ fontWeight: 600, color: dtMin ? "var(--text-error)" : "var(--text-secondary)" }}>{hoursOf(dtMin)}</b></span>
            <span>Other pay codes <b style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{hoursOf(otherMin)}</b></span>
          </span>
        </Kpi>
      </div>

      {/* Where the close stands in one sentence with the way to what to look
          at next, then the three steps, each open one linking to where it is
          dealt with, then open against locked. */}
      <section className="overflow-hidden" style={PANEL} aria-label="Close summary">
        <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2.5 px-5 py-4">
          <span className="grid h-[38px] w-[38px] flex-none place-items-center" style={{ borderRadius: 11, background: standTile.bg, color: standTile.fg }}>
            {standing.tone === "warning" ? <CircleAlert className="h-[18px] w-[18px]" aria-hidden /> : <CircleCheck className="h-[18px] w-[18px]" aria-hidden />}
          </span>
          <span className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5 pt-px">
            <span style={{ font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>{standing.title}</span>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>{standing.text}</span>
          </span>
          {next?.action && !isLocked && (
            <LinkButton href={next.action.href} hierarchy="secondary" size="sm">
              {next.action.text}
            </LinkButton>
          )}
        </div>
        <ol className="m-0 grid list-none p-0 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]" style={{ boxShadow: "inset 0 1px 0 var(--ta-well-ring)" }}>
          {steps.map((st, i) => {
            const isNext = st === next;
            const ring = st.done ? "var(--icon-success)" : isNext ? "var(--fill-warning)" : "var(--ta-ring-strong)";
            const inner = (
              <>
                <span className="flex items-start gap-2">
                  <span
                    className="tabular inline-flex h-6 w-6 flex-none items-center justify-center rounded-full"
                    aria-hidden
                    style={{
                      background: st.done ? "var(--surface-success)" : isNext ? "var(--surface-warning)" : "var(--surface-card)",
                      boxShadow: `inset 0 0 0 1.5px ${ring}`,
                      color: st.done ? "var(--icon-success)" : isNext ? "var(--text-warning)" : "var(--text-tertiary)",
                      font: "var(--weight-semibold) 12px/1 var(--font-sans)",
                    }}
                  >
                    {st.done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
                  </span>
                  <span className="pt-[3px]" style={{ font: "var(--weight-semibold) 13px/18px var(--font-sans)", color: st.done ? "var(--text-secondary)" : "var(--text-primary)", textWrap: "balance" }}>
                    {st.label}
                  </span>
                </span>
                <span
                  className="tabular pl-8"
                  style={{
                    font: `${isNext ? "var(--weight-semibold)" : "var(--weight-regular)"} 12px/16px var(--font-sans)`,
                    color: st.done ? "var(--text-success)" : isNext ? "var(--text-warning)" : "var(--text-tertiary)",
                  }}
                >
                  {st.caption}
                </span>
              </>
            );
            return (
              <li key={st.label} className="min-w-0" aria-current={isNext ? "step" : undefined} style={{ boxShadow: "1px 0 0 var(--ta-well-ring), 0 1px 0 var(--ta-well-ring)" }}>
                {st.action ? (
                  <Link href={st.action.href} title={st.detail} className="ta-hoverable flex h-full flex-col gap-1 px-4 py-3" style={{ textDecoration: "none" }}>
                    {inner}
                  </Link>
                ) : (
                  <div title={st.detail} className="flex h-full flex-col gap-1 px-4 py-3">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {T > 0 && (
          <div className="flex flex-col gap-2.5 px-5 py-3" style={{ boxShadow: "inset 0 1px 0 var(--ta-well-ring)" }}>
            <div
              className="flex h-2 w-full overflow-hidden rounded-full"
              style={{ background: "var(--ta-track)", gap: 2 }}
              role="img"
              aria-label={liveStages.map((st) => `${st.label} ${stageCount(st.key)}`).join(", ")}
            >
              {liveStages.map((st) => (
                <span key={st.key} className="block h-full" style={{ width: `${(stageCount(st.key) / T) * 100}%`, background: st.color }} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {liveStages.map((st) => (
                <span key={st.key} className="inline-flex items-center gap-1.5 whitespace-nowrap" title={st.owner}>
                  <span className="h-2 w-2 flex-none rounded-full" style={{ background: st.color }} aria-hidden />
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{st.label}</span>
                  <span className="tabular" style={{ font: "var(--type-body2)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                    {n(stageCount(st.key))}
                  </span>
                  <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{st.owner.toLowerCase()}</span>
                </span>
              ))}
              <span className="ml-auto" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                Every timesheet in the period, before the filters below
              </span>
            </div>
          </div>
        )}
      </section>

      <PayPeriodTimesheets
        timesheets={rows}
        total={T}
        payPeriodId={payPeriod.id}
        baseQuery={baseQuery}
        sites={sites}
        departments={departments}
        siteId={siteId}
        departmentId={departmentId}
        show={show}
      />
    </>
  );
}
