import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamExceptions } from "@/actions/supervisor.actions";
import { ExceptionActionPanel } from "@/components/supervisor/exception-action-panel";
import { ExceptionsFilter } from "@/components/supervisor/exceptions-filter";
import { db } from "@/lib/db";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";

const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PUNCH: "Missing Punch",
  LONG_SHIFT: "Long Shift",
  SHORT_BREAK: "Short Break",
  MISSED_MEAL: "Missed Meal",
  UNSCHEDULED_OT: "Unscheduled OT",
  CONSECUTIVE_DAYS: "Consecutive Days",
  ABSENT: "Absent",
};

const EXCEPTION_BADGE: Record<string, string> = {
  MISSING_PUNCH: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  LONG_SHIFT:    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  SHORT_BREAK:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  MISSED_MEAL:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  UNSCHEDULED_OT:"bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  CONSECUTIVE_DAYS:"bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  ABSENT:        "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function buildUrl(siteId?: string, departmentId?: string, employeeId?: string, exceptionType?: string, payPeriodId?: string) {
  const params = new URLSearchParams();
  if (siteId) params.set("siteId", siteId);
  if (departmentId) params.set("departmentId", departmentId);
  if (employeeId) params.set("employeeId", employeeId);
  if (exceptionType) params.set("exceptionType", exceptionType);
  if (payPeriodId) params.set("payPeriodId", payPeriodId);
  const qs = params.toString();
  return `/supervisor/exceptions${qs ? `?${qs}` : ""}`;
}

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; departmentId?: string; employeeId?: string; exceptionType?: string; payPeriodId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "TIMESHEET_APPROVE_TEAM")) redirect("/dashboard");

  const { siteId, departmentId, employeeId, exceptionType, payPeriodId } = await searchParams;
  const tenantId = session.user.tenantId as string;
  const now = new Date();

  const [result, sites, departments, rawPayPeriods] = await Promise.all([
    getTeamExceptions({ siteId, departmentId, exceptionType, payPeriodId }),
    db.site.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(siteId ? { sites: { some: { siteId } } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.payPeriod.findMany({
      where: { tenantId },
      orderBy: { startDate: "desc" },
      take: 8,
      select: { id: true, startDate: true, endDate: true, status: true },
    }),
  ]);

  const payPeriodOptions = rawPayPeriods.map((pp) => {
    const isCurrent = pp.startDate <= now && pp.endDate >= now && pp.status === "OPEN";
    return {
      id: pp.id,
      label: `${format(pp.startDate, "MMM d")} – ${format(pp.endDate, "MMM d, yyyy")}${isCurrent ? " (Current)" : ""}`,
    };
  });

  if (!result.success) redirect("/supervisor");

  const exceptions = result.data;

  // Build left-panel employee list (grouped + sorted)
  const empMap = new Map<string, { employeeId: string; name: string; exceptionTypes: string[] }>();
  for (const ex of exceptions) {
    const id = ex.timesheet.employeeId;
    if (!empMap.has(id)) {
      empMap.set(id, {
        employeeId: id,
        name: ex.timesheet.employee.user?.name ?? id,
        exceptionTypes: [],
      });
    }
    const entry = empMap.get(id)!;
    if (!entry.exceptionTypes.includes(ex.exceptionType)) {
      entry.exceptionTypes.push(ex.exceptionType);
    }
  }
  const employeeList = Array.from(empMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Right-panel exceptions (filtered to selected employee if any)
  const visibleExceptions = employeeId
    ? exceptions.filter((ex) => ex.timesheet.employeeId === employeeId)
    : exceptions;

  const selectedEmployee = employeeId ? empMap.get(employeeId) : null;

  return (
    <div className="flex h-[calc(100vh-7.25rem)] flex-col">
      {/* Header */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <Link
            href="/supervisor"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          >
            ← Team Portal
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
            Open Exceptions
          </h1>
        </div>
        <ExceptionsFilter
          sites={sites}
          departments={departments}
          payPeriods={payPeriodOptions}
          selectedSiteId={siteId}
          selectedDepartmentId={departmentId}
          selectedExceptionType={exceptionType}
          selectedPayPeriodId={payPeriodId}
        />
      </div>

      {/* Split pane */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: employee list */}
        <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Employees ({employeeList.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {employeeList.length === 0 ? (
              <p className="p-4 text-center text-xs text-zinc-400">No exceptions</p>
            ) : (
              <>
                {/* "All" row */}
                <Link
                  href={buildUrl(siteId, departmentId, undefined, exceptionType, payPeriodId)}
                  className={`flex w-full items-center justify-between border-b border-zinc-100 px-3 py-2.5 text-sm transition-colors dark:border-zinc-800/60 ${
                    !employeeId
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                      : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  All employees
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {exceptions.length}
                  </span>
                </Link>

                {employeeList.map((emp) => {
                  const isSelected = emp.employeeId === employeeId;
                  const count = exceptions.filter(
                    (ex) => ex.timesheet.employeeId === emp.employeeId
                  ).length;
                  return (
                    <Link
                      key={emp.employeeId}
                      href={buildUrl(siteId, departmentId, emp.employeeId, exceptionType, payPeriodId)}
                      className={`flex w-full flex-col border-b border-zinc-100 px-3 py-2.5 transition-colors dark:border-zinc-800/60 ${
                        isSelected
                          ? "bg-blue-50 dark:bg-blue-950/30"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={`truncate text-sm font-medium ${isSelected ? "text-zinc-900 dark:text-white" : "text-zinc-700 dark:text-zinc-300"}`}>
                          {emp.name}
                        </p>
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          {count}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {emp.exceptionTypes.map((t) => (
                          <span
                            key={t}
                            className={`rounded px-1 py-0.5 text-xs ${EXCEPTION_BADGE[t] ?? "bg-zinc-100 text-zinc-500"}`}
                          >
                            {EXCEPTION_LABEL[t] ?? t}
                          </span>
                        ))}
                      </div>
                    </Link>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Right: exception cards */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
          {selectedEmployee && (
            <div className="shrink-0 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                {selectedEmployee.name}
              </p>
              <p className="text-xs text-zinc-400">{visibleExceptions.length} exception{visibleExceptions.length !== 1 && "s"}</p>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4">
            {visibleExceptions.length === 0 && (
              <p className="py-8 text-center text-sm text-zinc-400">
                {employeeId ? "No exceptions for this employee." : "No open exceptions."}
              </p>
            )}
            <div className="flex flex-col gap-3">
              {visibleExceptions.map((ex) => (
                <div
                  key={ex.id}
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      {!employeeId && (
                        <p className="font-medium text-zinc-900 dark:text-white">
                          {ex.timesheet.employee.user?.name ?? `Employee ${ex.timesheet.employeeId}`}
                        </p>
                      )}
                      <p className={`text-xs text-zinc-400 ${!employeeId ? "mt-0.5" : ""}`}>
                        {ex.timesheet.employee.site?.name}
                        {ex.timesheet.employee.site && ex.timesheet.employee.department && " · "}
                        {ex.timesheet.employee.department?.name}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${EXCEPTION_BADGE[ex.exceptionType] ?? "bg-zinc-100 text-zinc-500"}`}>
                          {EXCEPTION_LABEL[ex.exceptionType] ?? ex.exceptionType}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {format(ex.occurredAt, "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        Pay period:{" "}
                        {format(ex.timesheet.payPeriod.startDate, "MMM d")} –{" "}
                        {format(ex.timesheet.payPeriod.endDate, "MMM d, yyyy")}
                      </p>
                      {ex.description && (
                        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                          {ex.description}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/payroll/timecards?payPeriodId=${ex.timesheet.payPeriod.id}&employeeId=${ex.timesheet.employeeId}`}
                      className="shrink-0 flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View Timecard
                    </Link>
                  </div>
                  <ExceptionActionPanel
                    exceptionId={ex.id}
                    exceptionType={ex.exceptionType}
                    timesheetId={ex.timesheetId}
                    punches={ex.timesheet.punches}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
