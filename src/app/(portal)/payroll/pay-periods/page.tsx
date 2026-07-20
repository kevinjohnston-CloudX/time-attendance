import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { getPayPeriods, getPayPeriodDetail } from "@/actions/pay-period.actions";
import { getAdpConfig } from "@/lib/integrations/adp/client";
import { PAY_PERIOD_STATUS_LABEL } from "@/lib/state-machines/labels";
import { PayPeriodActions } from "@/components/payroll/pay-period-actions";
import { PayPeriodsFilter } from "@/components/payroll/pay-periods-filter";
import { format } from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";
import { PayPeriodTimesheets } from "@/components/payroll/pay-period-timesheets";
import { PayPeriodDetailFilter } from "@/components/payroll/pay-period-detail-filter";

const PP_BADGE: Record<string, string> = {
  OPEN:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  READY:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  LOCKED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

type FilterValue = "all" | "current" | "open" | "ready" | "locked" | "ytd";

export default async function PayPeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; filter?: string; siteId?: string; departmentId?: string }>;
}) {
  const { id: selectedId, filter, siteId, departmentId } = await searchParams;
  const currentFilter: FilterValue =
    filter === "current" || filter === "open" || filter === "ready" || filter === "locked" || filter === "ytd"
      ? filter
      : "all";

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/dashboard");

  const t = session.user.tenantId ?? undefined;

  const [ppResult, sites, departments] = await Promise.all([
    getPayPeriods(),
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

  // Apply filter for the visible list
  const payPeriods = allPayPeriods.filter((pp) => {
    if (currentFilter === "current") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return parseUtcDate(pp.startDate) <= today && today <= parseUtcDate(pp.endDate);
    }
    if (currentFilter === "open") return pp.status === "OPEN";
    if (currentFilter === "ready") return pp.status === "READY";
    if (currentFilter === "locked") return pp.status === "LOCKED";
    if (currentFilter === "ytd") {
      return (
        parseUtcDate(pp.startDate).getFullYear() === currentYear ||
        parseUtcDate(pp.endDate).getFullYear() === currentYear
      );
    }
    return true;
  });

  // Serialise for client component
  const serialisedAll = allPayPeriods.map((pp) => ({
    id: pp.id,
    startDate: pp.startDate.toISOString(),
    endDate: pp.endDate.toISOString(),
    status: pp.status,
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
    <div className="flex items-start gap-0 -mx-6 -my-8 h-screen">
      {/* ── Left panel: list ─────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800 sticky top-0 h-screen flex flex-col overflow-hidden">
        <div className="px-4 pt-6 pb-3 flex items-center justify-between shrink-0">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Pay Periods</h1>
          <Link
            href="/payroll/timecards"
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            Timecards
          </Link>
        </div>

        <PayPeriodsFilter
          allPayPeriods={serialisedAll}
          selectedId={selectedId}
          currentFilter={currentFilter}
          siteId={siteId}
          departmentId={departmentId}
        />

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {payPeriods.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">No pay periods found.</p>
          )}
          <div className="flex flex-col">
            {payPeriods.map((pp) => {
              const total = pp.timesheets.length;
              const approved = pp.timesheets.filter(
                (t) => t.status === "PAYROLL_APPROVED" || t.status === "LOCKED"
              ).length;
              const isSelected = pp.id === selectedId;
              const siteParam = siteId ? `&siteId=${siteId}` : "";
              const deptParam = departmentId ? `&departmentId=${departmentId}` : "";
              const href = `/payroll/pay-periods?id=${pp.id}${currentFilter !== "all" ? `&filter=${currentFilter}` : ""}${siteParam}${deptParam}`;

              return (
                <Link
                  key={pp.id}
                  href={href}
                  className={`flex flex-col border-b border-zinc-100 px-4 py-3 transition-colors dark:border-zinc-800 ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-950/20 border-l-2 border-l-blue-500"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                      {format(pp.startDate, "MMM d")} – {format(pp.endDate, "MMM d, yyyy")}
                    </p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${PP_BADGE[pp.status]}`}>
                      {PAY_PERIOD_STATUS_LABEL[pp.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {approved}/{total} approved
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Right panel: detail ───────────────────────────────── */}
      <div className="flex-1 overflow-y-auto h-screen px-6 py-6">
        {!detail ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-400">Select a pay period to view details</p>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
                  {format(detail.payPeriod.startDate, "MMM d")} –{" "}
                  {format(detail.payPeriod.endDate, "MMM d, yyyy")}
                </h2>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`rounded-full px-3 py-0.5 text-xs font-medium ${PP_BADGE[detail.payPeriod.status]}`}>
                    {PAY_PERIOD_STATUS_LABEL[detail.payPeriod.status]}
                  </span>
                </div>
              </div>
              <PayPeriodActions
                payPeriodId={detail.payPeriod.id}
                status={detail.payPeriod.status}
                isReady={detail.validation.isReady}
                adpConfigured={adpConfigured}
                payrollRun={payrollRun}
              />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Total Timesheets</p>
                <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
                  {detail.validation.totalTimesheets}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Approved</p>
                <p className="mt-1 text-2xl font-bold text-green-600">
                  {detail.validation.approvedCount}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pending / Issues</p>
                <p className={`mt-1 text-2xl font-bold ${
                  detail.validation.pendingCount > 0 || detail.validation.unresolvedExceptions > 0
                    ? "text-red-600"
                    : "text-zinc-900 dark:text-white"
                }`}>
                  {detail.validation.pendingCount + detail.validation.unresolvedExceptions}
                </p>
              </div>
            </div>

            {(() => {
              const issuesByTs = new Map<string, string[]>();
              for (const iss of detail.validation.issues) {
                const list = issuesByTs.get(iss.timesheetId) ?? [];
                list.push(iss.issue);
                issuesByTs.set(iss.timesheetId, list);
              }
              const filteredSheets = detail.payPeriod.timesheets.filter((ts) => {
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
              }));
              return (
                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Timesheets</h2>
                    <PayPeriodDetailFilter
                      payPeriodId={detail.payPeriod.id}
                      currentFilter={currentFilter}
                      sites={sites}
                      departments={departments}
                      selectedSiteId={siteId}
                      selectedDepartmentId={departmentId}
                    />
                  </div>
                  <div className="mt-2">
                    <PayPeriodTimesheets timesheets={tileData} payPeriodId={detail.payPeriod.id} />
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
