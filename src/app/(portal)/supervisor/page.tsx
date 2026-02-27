import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { Users, AlertCircle, ClipboardList, CalendarDays, CalendarCheck } from "lucide-react";

export default async function SupervisorDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "TIMESHEET_APPROVE_TEAM")) redirect("/dashboard");

  const employeeId = session.user.employeeId ?? "";
  const isPayroll = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"].includes(
    session.user.role
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [pendingTimesheets, openExceptions, pendingLeave, upcomingLeave] = await Promise.all([
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
        status: { in: ["APPROVED", "POSTED"] },
        endDate: { gte: today },
        ...(isPayroll ? {} : { employee: { supervisorId: employeeId } }),
      },
    }),
  ]);

  const cards = [
    {
      label: isPayroll ? "Awaiting Payroll Approval" : "Awaiting Approval",
      count: pendingTimesheets,
      href: "/supervisor/timesheets",
      icon: ClipboardList,
      urgency: pendingTimesheets > 0,
    },
    {
      label: "Open Exceptions",
      count: openExceptions,
      href: "/supervisor/exceptions",
      icon: AlertCircle,
      urgency: openExceptions > 0,
    },
    {
      label: "Pending Leave Requests",
      count: pendingLeave,
      href: "/supervisor/leave",
      icon: CalendarDays,
      urgency: pendingLeave > 0,
    },
    {
      label: "Upcoming Leave",
      count: upcomingLeave,
      href: "/supervisor/leave",
      icon: CalendarCheck,
      urgency: false,
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-zinc-400" />
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          {isPayroll ? "Payroll Portal" : "My Team"}
        </h1>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
          >
            <div>
              <p className="text-sm text-zinc-500">{card.label}</p>
              <p
                className={`mt-1 text-3xl font-bold ${
                  card.urgency && card.count > 0
                    ? "text-amber-500"
                    : "text-zinc-900 dark:text-white"
                }`}
              >
                {card.count}
              </p>
            </div>
            <card.icon
              className={`h-8 w-8 ${
                card.urgency && card.count > 0
                  ? "text-amber-400"
                  : "text-zinc-300 dark:text-zinc-700"
              }`}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
