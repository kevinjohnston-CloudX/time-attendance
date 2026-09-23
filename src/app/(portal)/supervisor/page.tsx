import { redirect } from "next/navigation";
import Link from "next/link";
import { addDays, format } from "date-fns";
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { parseUtcDate } from "@/lib/utils/date";
import { getApprovalQueue, getPresence } from "@/lib/dashboard/dashboard-data";
import { getExceptionTypes, getTeamQueues, getTimeOffAhead } from "@/lib/team/team-overview";
import { EXCEPTION_TYPE_LABEL } from "@/lib/state-machines/labels";
import { Badge, Card, LinkButton, exceptionTone } from "@/components/ui";

/**
 * Team Overview: the screen the Team section opens on.
 *
 * <p>Answers the three things a supervisor or payroll opens it for, in that
 * order: what is waiting on me, who is here today, and what is coming. The
 * work queue leads, drawn like the Administration rows, one row per queue with
 * its count and where it goes. Under it, four panels that each answer one
 * question and link to the page that owns it.
 *
 * <p>It replaces a warning banner and five count cards. Every count and every
 * link they carried is still here: the four queues are the rows, and upcoming
 * leave is the Time Off Ahead panel.
 *
 * <p>Who sees what: supervisors see their direct reports, payroll and HR see
 * the whole tenant. Both are enforced in the where clause of every query, not
 * by what is drawn.
 */

/**
 * Two panels side by side, the same height as each other. Stretching rather
 * than aligning to the top is what keeps a pair from looking like two
 * unrelated boxes when one of them has fewer rows.
 */
const GRID =
  "grid gap-4 items-stretch [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(340px,44%)),1fr))]";

/** Every list in a panel uses the same row, so the pairs line up row for row. */
const ROW = "flex min-h-[48px] items-center gap-3 py-2";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function dateRange(start: Date, end: Date): string {
  const s = parseUtcDate(start);
  const e = parseUtcDate(end);
  if (s.getTime() === e.getTime()) return format(s, "EEE MMM d");
  if (s.getMonth() === e.getMonth()) return `${format(s, "MMM d")} to ${format(e, "d")}`;
  return `${format(s, "MMM d")} to ${format(e, "MMM d")}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default async function TeamOverviewPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "TIMESHEET_APPROVE_TEAM"))) redirect("/dashboard");

  const employeeId = session.user.employeeId ?? null;
  const tenantId = (session.user as { tenantId?: string }).tenantId;
  if (!tenantId) redirect("/dashboard");
  const isPayroll = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"].includes(session.user.role);
  const now = new Date();

  const [queues, exceptionTypes, timeOff, presence, approvals, payPeriod, me, canSeeOnSite] = await Promise.all([
    getTeamQueues(tenantId, employeeId, isPayroll, now),
    getExceptionTypes(tenantId, employeeId, isPayroll),
    getTimeOffAhead(tenantId, employeeId, isPayroll, now),
    getPresence(tenantId, isPayroll ? null : employeeId),
    getApprovalQueue(employeeId, tenantId, isPayroll, 5),
    db.payPeriod.findFirst({
      where: { tenantId, ruleSetId: { not: null }, startDate: { lte: now }, endDate: { gt: now }, status: "OPEN" },
      select: { startDate: true, endDate: true },
    }),
    employeeId
      ? db.employee.findFirst({
          where: { id: employeeId, tenantId },
          select: { site: { select: { name: true, timezone: true } } },
        })
      : null,
    userHasPermission(session.user, "PRESENCE_VIEW_ANY"),
  ]);

  // ── Pay period line ───────────────────────────────────────────────────────
  const periodLabel = payPeriod
    ? `${format(parseUtcDate(payPeriod.startDate), "MMM d")} to ${format(addDays(parseUtcDate(payPeriod.endDate), -1), "MMM d")}`
    : null;
  const daysLeft = payPeriod
    ? Math.max(
        0,
        Math.ceil(
          (parseUtcDate(payPeriod.endDate).getTime() -
            new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
            86_400_000,
        ),
      )
    : 0;
  const elapsedPct = payPeriod
    ? Math.min(
        100,
        Math.max(
          0,
          ((now.getTime() - parseUtcDate(payPeriod.startDate).getTime()) /
            (parseUtcDate(payPeriod.endDate).getTime() - parseUtcDate(payPeriod.startDate).getTime())) *
            100,
        ),
      )
    : 0;

  const timezone = me?.site?.timezone || "America/New_York";
  const asOf = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(now);

  // ── The work queue ────────────────────────────────────────────────────────
  // `actionable` is whether this viewer can do anything about the count. A
  // supervisor cannot decide leave that is already with HR, so for them that
  // row is information and its count stays grey.
  const queueRows = [
    {
      key: "timesheets",
      icon: <ClipboardCheck className="h-[17px] w-[17px]" />,
      label: isPayroll ? "Timesheets for payroll sign off" : "Timesheets to approve",
      detail: isPayroll
        ? "Approved by supervisors and waiting on the payroll approval"
        : "Submitted by your team and waiting on your approval",
      count: queues.timesheets,
      href: "/supervisor/timesheets",
      actionable: true,
      tone: "warning" as const,
    },
    {
      key: "exceptions",
      icon: <TriangleAlert className="h-[17px] w-[17px]" />,
      label: "Exceptions to resolve",
      detail: "Missing punches and rule breaks that keep hours wrong until they are fixed",
      count: queues.exceptions,
      href: "/supervisor/exceptions",
      actionable: true,
      tone: "error" as const,
    },
    {
      key: "leave",
      icon: <CalendarClock className="h-[17px] w-[17px]" />,
      label: "Leave requests to decide",
      detail: isPayroll ? "Waiting on a supervisor's decision" : "Time off your team has asked for",
      count: queues.leavePending,
      href: "/supervisor/leave?tab=pending",
      actionable: true,
      tone: "warning" as const,
    },
    {
      key: "hr",
      icon: <CalendarDays className="h-[17px] w-[17px]" />,
      label: isPayroll ? "Leave awaiting HR approval" : "Leave with HR",
      detail: isPayroll
        ? "Approved on the floor and waiting on the HR decision"
        : "You approved these, and HR makes the final decision",
      count: queues.leaveWithHr,
      href: "/supervisor/leave?tab=hr-pending",
      actionable: isPayroll,
      tone: "warning" as const,
    },
  ];

  const waitingTotal = queueRows.filter((r) => r.actionable).reduce((n, r) => n + r.count, 0);
  const exceptionMax = exceptionTypes[0]?.count ?? 0;
  const presenceTotal = presence.onClock + presence.onMeal + presence.notIn + presence.onLeave;

  return (
    <div className="flex flex-col gap-4">
      {/* Pinned, like every list screen, so the page name and its way out stay
          on screen while the panels scroll. It does not shrink, and it does not
          move either: it is pulled up into the page's top padding (-mt-4 pt-4)
          so it already sits where it pins, instead of sliding 16px first. */}
      <div
        className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-wrap items-end gap-3 px-4 pb-3 pt-4"
        style={{ background: "var(--surface-page)" }}
      >
        <div className="flex min-w-60 flex-1 flex-col gap-0.5">
          <h1 style={{ margin: 0, font: "var(--type-h1)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            Team Overview
          </h1>
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
            {isPayroll ? "Every team" : "Your direct reports"}
            {periodLabel ? ` · Pay period ${periodLabel}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSeeOnSite && (
            <LinkButton href="/supervisor/on-site" hierarchy="secondary">
              Live Attendance
            </LinkButton>
          )}
          <LinkButton href="/supervisor/timesheets" hierarchy="primary">
            Review Timesheets
          </LinkButton>
        </div>
      </div>

      {/* ── Work queue ───────────────────────────────────────────────────── */}
      <Card
        padding={0}
        title="Work Queue"
        subtitle={
          waitingTotal > 0
            ? `${plural(waitingTotal, "item")} waiting on ${isPayroll ? "payroll and HR" : "you"}${payPeriod ? ", to clear before the period closes" : ""}`
            : "Nothing is waiting on you"
        }
        actions={
          payPeriod ? (
            <div className="flex w-[180px] flex-col items-end gap-1.5">
              <span className="tabular whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                {daysLeft === 0 ? "Closes today" : `${plural(daysLeft, "day")} left in the period`}
              </span>
              <span
                className="block h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--ta-track)" }}
                role="img"
                aria-label={`${Math.round(elapsedPct)} percent of the pay period has gone`}
              >
                <span className="block h-full rounded-full" style={{ width: `${elapsedPct}%`, background: "var(--fill-accent)" }} />
              </span>
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-col" style={{ gap: 1, background: "var(--stroke-divider)" }}>
          {queueRows.map((r) => (
            <Link
              key={r.key}
              href={r.href}
              className="ta-hoverable grid items-center gap-x-3.5 px-4 py-3 [grid-template-columns:32px_minmax(0,1fr)_auto_18px]"
              style={{ background: "var(--surface-card)", color: "var(--text-primary)", textDecoration: "none" }}
            >
              <span
                className="inline-flex items-center justify-center"
                style={{ width: 32, height: 32, borderRadius: 9, background: "var(--surface-info)", color: "var(--icon-accent)" }}
              >
                {r.icon}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)" }}>{r.label}</span>
                <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  {r.detail}
                </span>
              </span>
              <CountPill count={r.count} actionable={r.actionable} tone={r.tone} />
              <ChevronRight className="h-[17px] w-[17px]" style={{ color: "var(--icon-tertiary)" }} />
            </Link>
          ))}
        </div>
      </Card>

      {/* ── Today, and what is coming ────────────────────────────────────── */}
      <div className={GRID}>
        <Card
          title="Attendance Today"
          subtitle={`Clocked in right now, as of ${asOf}`}
          actions={
            canSeeOnSite ? (
              <LinkButton href="/supervisor/on-site" hierarchy="tertiary" size="sm">
                Open Live Attendance
              </LinkButton>
            ) : undefined
          }
        >
          {presenceTotal === 0 ? (
            <Quiet>{isPayroll ? "There are no active employees yet." : "Nobody reports to you yet."}</Quiet>
          ) : (
            <div className="flex flex-col gap-3.5">
              <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]">
                <Tile label="On the clock" value={presence.onClock} dot="var(--fill-success)" />
                <Tile label="On meal or break" value={presence.onMeal} dot="var(--fill-warning)" />
                <Tile label="Not in" value={presence.notIn} dot="var(--stroke-default)" />
                <Tile label="On leave" value={presence.onLeave} dot="var(--icon-accent)" />
              </div>
              {presence.byDept.length > 0 && (
                <div className="flex flex-col">
                  {presence.byDept.map((d) => {
                    const inPct = d.total ? (d.inCount / d.total) * 100 : 0;
                    const mealPct = d.total ? (d.mealCount / d.total) * 100 : 0;
                    return (
                      <div
                        key={d.dept}
                        className="grid min-h-[40px] items-center gap-3 py-2 [grid-template-columns:140px_minmax(0,1fr)_72px]"
                        style={{ borderTop: "1px solid var(--stroke-divider)" }}
                      >
                        <span className="truncate" style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)" }} title={d.dept}>
                          {d.dept}
                        </span>
                        <span className="flex h-2 overflow-hidden rounded-full" style={{ background: "var(--ta-track)" }}>
                          <span style={{ width: `${inPct}%`, background: "var(--fill-success)" }} />
                          <span style={{ width: `${mealPct}%`, background: "var(--fill-warning)" }} />
                        </span>
                        <span className="tabular whitespace-nowrap text-right" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                          {d.inCount + d.mealCount} of {d.total}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card
          title="Time Off Ahead"
          subtitle={
            timeOff.total === 0
              ? "Approved leave in the next 14 days"
              : `${plural(timeOff.offToday, "person", "people")} off today, ${plural(timeOff.total, "absence")} in the next 14 days`
          }
          actions={
            <LinkButton href="/supervisor/leave?tab=upcoming" hierarchy="tertiary" size="sm">
              Team Calendar
            </LinkButton>
          }
        >
          {timeOff.rows.length === 0 ? (
            <Quiet>Nobody has approved time off in the next two weeks.</Quiet>
          ) : (
            <div className="flex flex-col">
              {timeOff.rows.map((r, i) => {
                const onNow = parseUtcDate(r.startDate) <= now;
                return (
                  <div
                    key={r.id}
                    className={ROW}
                    style={{ borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)" }}
                  >
                    <Avatar name={r.name} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate" style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)" }}>
                        {r.name}
                      </span>
                      <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                        {[r.leaveType, r.department].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex flex-none items-center gap-2">
                      {onNow && (
                        <Badge tone="info" size="sm">
                          Off today
                        </Badge>
                      )}
                      <span className="tabular whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                        {dateRange(r.startDate, r.endDate)}
                      </span>
                    </span>
                  </div>
                );
              })}
              {timeOff.total > timeOff.rows.length && (
                <Link
                  href="/supervisor/leave?tab=upcoming"
                  className="pt-2.5"
                  style={{ font: "var(--type-body2)", color: "var(--text-accent)", textDecoration: "none" }}
                >
                  {plural(timeOff.total - timeOff.rows.length, "more absence", "more absences")}
                </Link>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ── What to work down ────────────────────────────────────────────── */}
      <div className={GRID}>
        <Card
          title="Waiting Longest"
          subtitle={isPayroll ? "Oldest timesheets waiting on payroll" : "Oldest timesheets waiting on your approval"}
          actions={
            <LinkButton href="/supervisor/timesheets" hierarchy="tertiary" size="sm">
              Review All
            </LinkButton>
          }
        >
          {approvals.rows.length === 0 ? (
            <Quiet icon>Every submitted timesheet has been approved.</Quiet>
          ) : (
            <div className="flex flex-col">
              {approvals.rows.map((r, i) => (
                <div
                  key={r.id}
                  className={ROW}
                  style={{ borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)" }}
                >
                  <Avatar name={r.name} />
                  <span className="min-w-0 flex-1 truncate" style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)" }}>
                    {r.name}
                  </span>
                  <span className="tabular whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                    {r.hours} h
                  </span>
                  {r.tone ? (
                    <Badge tone="warning" size="sm">
                      {r.kind}
                    </Badge>
                  ) : (
                    <Badge tone="success" size="sm">
                      No exceptions
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Exceptions by Type"
          subtitle={queues.exceptions === 0 ? "Open exceptions" : `${plural(queues.exceptions, "open exception")}, largest first`}
          actions={
            <LinkButton href="/supervisor/exceptions" hierarchy="tertiary" size="sm">
              Open Exceptions
            </LinkButton>
          }
        >
          {exceptionTypes.length === 0 ? (
            <Quiet icon>Every timecard is clean. There is nothing to resolve.</Quiet>
          ) : (
            <div className="flex flex-col">
              {exceptionTypes.slice(0, 6).map((t, i) => (
                <Link
                  key={t.type}
                  href={`/supervisor/exceptions?exceptionType=${t.type}`}
                  className="ta-hoverable grid min-h-[48px] items-center gap-3 py-2 [grid-template-columns:140px_minmax(0,1fr)_56px_14px]"
                  style={{
                    color: "var(--text-primary)",
                    textDecoration: "none",
                    borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)",
                  }}
                >
                  <span className="min-w-0">
                    <Badge tone={exceptionTone(t.type)} size="sm">
                      {EXCEPTION_TYPE_LABEL[t.type] ?? t.type}
                    </Badge>
                  </span>
                  <span className="flex h-1.5 overflow-hidden rounded-full" style={{ background: "var(--ta-track)" }}>
                    <span
                      className="rounded-full"
                      style={{ width: `${exceptionMax ? (t.count / exceptionMax) * 100 : 0}%`, background: "var(--stroke-hover)" }}
                    />
                  </span>
                  <span className="tabular text-right" style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)" }}>
                    {t.count.toLocaleString()}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--icon-tertiary)" }} />
                </Link>
              ))}
              {exceptionTypes.length > 6 && (
                <span className="pt-2.5" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  {plural(exceptionTypes.length - 6, "more type")} on the Exceptions screen
                </span>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/**
 * The count at the end of a work queue row. Tinted only when there is
 * something this viewer can act on; a clear queue says so in green instead of
 * showing a zero somebody has to interpret.
 */
function CountPill({ count, actionable, tone }: { count: number; actionable: boolean; tone: "warning" | "error" }) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 24,
    minWidth: 32,
    justifyContent: "center",
    padding: "0 9px",
    borderRadius: 999,
    whiteSpace: "nowrap" as const,
    font: "var(--weight-semibold) 13px/18px var(--font-sans)",
    fontVariantNumeric: "tabular-nums",
  };
  if (count === 0) {
    return (
      <span style={{ ...base, background: "var(--surface-success)", color: "var(--text-success)", boxShadow: "inset 0 0 0 1px var(--stroke-success)" }}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Clear
      </span>
    );
  }
  if (!actionable) {
    return <span style={{ ...base, background: "var(--ta-track)", color: "var(--text-secondary)" }}>{count.toLocaleString()}</span>;
  }
  const t =
    tone === "error"
      ? { bg: "var(--surface-error)", fg: "var(--text-error)", line: "var(--stroke-error)" }
      : { bg: "var(--surface-warning)", fg: "var(--text-warning)", line: "var(--stroke-warning)" };
  return (
    <span style={{ ...base, background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1px ${t.line}` }}>
      {count.toLocaleString()}
    </span>
  );
}

function Tile({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--stroke-secondary)" }}>
      <span className="tabular" style={{ font: "var(--weight-semibold) 22px/28px var(--font-sans)", color: "var(--text-primary)" }}>
        {value.toLocaleString()}
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap" style={{ font: "var(--weight-medium) 13px/18px var(--font-sans)", color: "var(--text-secondary)" }}>
        <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: dot }} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full"
      style={{ background: "var(--surface-tertiary)", color: "var(--text-secondary)", font: "var(--weight-semibold) 12px/1 var(--font-sans)" }}
    >
      {initialsOf(name)}
    </span>
  );
}

function Quiet({ children, icon = false }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <p className="flex items-center gap-2" style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
      {icon && <UserCheck className="h-4 w-4 flex-none" style={{ color: "var(--icon-success)" }} aria-hidden="true" />}
      {children}
    </p>
  );
}
