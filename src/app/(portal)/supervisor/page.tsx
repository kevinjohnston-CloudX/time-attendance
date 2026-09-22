import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { Banner, PageHeader } from "@/components/ui";

/**
 * Team Overview — the screen the Team section opens on.
 *
 * <p>The portal design has no drawing for this page: its sidebar goes straight
 * into Team Timesheets. So it follows the Administration hub (Template D)
 * instead — a banner naming what is blocking the period, then one card per
 * queue carrying its count and where it goes.
 *
 * <p>The counts are the five this page already ran, unchanged. A hub that
 * costs more than the screens it links to is a hub people learn to skip.
 */

/** "3 timesheets, 5 exceptions and 2 leave requests" — an Oxford-less list. */
function sentence(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

export default async function SupervisorDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "TIMESHEET_APPROVE_TEAM")) redirect("/dashboard");

  const employeeId = session.user.employeeId ?? "";
  const isPayroll = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"].includes(
    session.user.role
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [pendingTimesheets, openExceptions, pendingLeave, hrPendingLeave, upcomingLeave] = await Promise.all([
    db.timesheet.count({
      where: isPayroll
        ? { status: "SUP_APPROVED" }
        : { employee: { supervisorId: employeeId }, status: "SUBMITTED" },
    }),
    db.exception.count({
      where: {
        resolvedAt: null,
        ...(isPayroll
          ? {}
          : { timesheet: { employee: { supervisorId: employeeId } } }),
      },
    }),
    db.leaveRequest.count({
      where: {
        status: "PENDING",
        ...(isPayroll ? {} : { employee: { supervisorId: employeeId } }),
      },
    }),
    db.leaveRequest.count({
      where: {
        status: "PENDING_HR",
        ...(isPayroll ? {} : { employee: { supervisorId: employeeId } }),
      },
    }),
    db.leaveRequest.count({
      where: {
        status: { in: ["APPROVED", "POSTED"] },
        endDate: { gte: today },
        ...(isPayroll ? {} : { employee: { supervisorId: employeeId } }),
      },
    }),
  ]);

  const cards = [
    {
      label: isPayroll ? "Awaiting Payroll Approval" : "Awaiting Approval",
      detail: isPayroll
        ? "Supervisor-approved timesheets, ready for the payroll sign-off."
        : "Submitted timesheets that need your sign-off.",
      count: pendingTimesheets,
      href: "/supervisor/timesheets",
      icon: ClipboardList,
      urgency: pendingTimesheets > 0,
    },
    {
      label: "Open Exceptions",
      detail: "Missing punches and rule breaks to resolve before close.",
      count: openExceptions,
      href: "/supervisor/exceptions",
      icon: AlertCircle,
      urgency: openExceptions > 0,
    },
    {
      label: "Pending Leave Requests",
      detail: "Time off waiting on your decision.",
      count: pendingLeave,
      href: "/supervisor/leave",
      icon: CalendarDays,
      urgency: pendingLeave > 0,
    },
    {
      label: isPayroll ? "Leave Awaiting HR Approval" : "Leave Pending HR Review",
      detail: isPayroll
        ? "Approved on the floor, waiting on the HR decision."
        : "Already approved by you — HR has these now.",
      count: hrPendingLeave,
      href: "/supervisor/leave?tab=hr-pending",
      icon: CalendarDays,
      // A supervisor cannot action PENDING_HR, so it is information for them
      // and a queue for payroll. Only the second is coloured as work to do.
      urgency: isPayroll && hrPendingLeave > 0,
    },
    {
      label: "Upcoming Leave",
      detail: "Approved absences from today onward.",
      count: upcomingLeave,
      href: "/supervisor/leave",
      icon: CalendarCheck,
      urgency: false,
    },
  ];

  const waiting = [
    pendingTimesheets > 0 && plural(pendingTimesheets, "timesheet"),
    openExceptions > 0 && plural(openExceptions, "exception"),
    pendingLeave > 0 && plural(pendingLeave, "leave request"),
    isPayroll && hrPendingLeave > 0 && `${hrPendingLeave} with HR`,
  ].filter(Boolean) as string[];

  const needsDecision = cards
    .filter((c) => c.urgency)
    .reduce((n, c) => n + c.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={isPayroll ? "Payroll Portal" : "My Team"}
        subtitle={
          isPayroll
            ? "Timesheets, exceptions and leave waiting on payroll"
            : "Timesheets, exceptions and leave waiting on you"
        }
      />

      <Banner
        tone={needsDecision > 0 ? "warning" : "success"}
        title={
          needsDecision > 0
            ? `${plural(needsDecision, "item")} ${needsDecision === 1 ? "needs" : "need"} a decision`
            : "Nothing is waiting on you"
        }
        body={
          needsDecision > 0
            ? `${sentence(waiting)} — all of it has to clear before this pay period can close.`
            : "Every timesheet, exception and leave request in your queues has been actioned."
        }
        meta={
          upcomingLeave > 0
            ? `${plural(upcomingLeave, "approved absence")} on the calendar from today onward.`
            : undefined
        }
      />

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,248px),1fr))]">
        {cards.map((card) => {
          const urgent = card.urgency && card.count > 0;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="ta-hub-card flex items-start gap-3 rounded-xl p-4"
              style={{
                border: "1px solid var(--stroke-secondary)",
                background: "var(--surface-card)",
                color: "var(--text-primary)",
                textDecoration: "none",
              }}
            >
              <span
                className="inline-flex flex-none items-center justify-center"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: urgent ? "var(--surface-warning)" : "var(--surface-info)",
                  color: urgent ? "var(--icon-warning)" : "var(--icon-accent)",
                }}
              >
                <card.icon className="h-5 w-5" />
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="wms-overline">{card.label}</span>
                <span
                  className="tabular"
                  style={{
                    font: "var(--type-h2)",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-0.02em",
                    color: urgent ? "var(--text-warning)" : "var(--text-primary)",
                  }}
                >
                  {card.count}
                </span>
                <span
                  style={{
                    font: "var(--type-body2)",
                    color: "var(--text-secondary)",
                    textWrap: "pretty",
                  }}
                >
                  {card.detail}
                </span>
              </span>

              <ChevronRight className="mt-1 h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
