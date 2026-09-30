import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { getPayPeriods, getPayPeriodDetail } from "@/actions/pay-period.actions";
import { getAdpConfig } from "@/lib/integrations/adp/client";
import { PAY_PERIOD_STATUS_LABEL } from "@/classic/lib/labels";
import { PayPeriodActions } from "@/classic/components/payroll/pay-period-actions";
import { PayPeriodsFilter } from "@/classic/components/payroll/pay-periods-filter";
import { format, addDays } from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";
import { PayPeriodTimesheets } from "@/classic/components/payroll/pay-period-timesheets";
import { PayPeriodDetailFilter } from "@/classic/components/payroll/pay-period-detail-filter";
import { PayPeriodDownload } from "@/classic/components/payroll/pay-period-download";

const PP_BADGE: Record<string, string> = {
  OPEN:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  READY:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  LOCKED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

type FilterValue = "all" | "current" | "ytd";
type StatusFilter = "all" | "open" | "locked";

export default async function PayPeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; filter?: string; status?: string; month?: string; siteId?: string; departmentId?: string }>;
}) {
  const { id: selectedId, filter, status, month, siteId, departmentId } = await searchParams;
  const currentFilter: FilterValue =
    filter === "current" || filter === "ytd" ? filter : "all";
  const statusFilter: StatusFilter =
    status === "open" || status === "locked" ? status : "all";
  // month param: "YYYY-MM" — when set, overrides scope filter for the visible list
  const monthParam = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : null;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/dashboard");
  const canRunPayroll = await userHasPermission(session.user, "PAYROLL_RUN");

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
  const lockedCount = detail
    ? detail.payPeriod.timesheets.filter((ts) => ts.status === "LOCKED").length
    : 0;

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
          statusFilter={statusFilter}
          monthParam={monthParam ?? undefined}
          siteId={siteId}
          departmentId={departmentId}
        />

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {payPeriods.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">No pay periods found.</p>
          )}
          {(() => {
            const FREQ_LABEL: Record<string, string> = {
              WEEKLY: "Weekly", BIWEEKLY: "Biweekly",
              SEMI_MONTHLY: "Semi-monthly", MONTHLY: "Monthly",
            };

            const groupMap = new Map<string, { name: string; frequency: string | null; periods: typeof payPeriods }>();
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

            const renderItem = (pp: typeof payPeriods[number]) => {
              const total = pp.timesheets.length;
              const locked = pp.timesheets.filter((t) => t.status === "LOCKED").length;
              const isSelected = pp.id === selectedId;
              const siteParam = siteId ? `&siteId=${siteId}` : "";
              const deptParam = departmentId ? `&departmentId=${departmentId}` : "";
              const monthHref = monthParam ? `&month=${monthParam}` : "";
              const filterHref = !monthParam && currentFilter !== "all" ? `&filter=${currentFilter}` : "";
              const statusHref = statusFilter !== "all" ? `&status=${statusFilter}` : "";
              const href = `/payroll/pay-periods?id=${pp.id}${filterHref}${statusHref}${monthHref}${siteParam}${deptParam}`;
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
                      {format(pp.startDate, "MMM d")} – {format(addDays(pp.endDate, -1), "MMM d, yyyy")}
                    </p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${PP_BADGE[pp.status]}`}>
                      {PAY_PERIOD_STATUS_LABEL[pp.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {locked}/{total} locked
                  </p>
                </Link>
              );
            };

            return (
              <div className="flex flex-col">
                {groups.map((group) => (
                  <div key={group.name}>
                    {showHeaders && (
                      <div className="sticky top-0 z-10 border-b border-zinc-100 bg-zinc-50 px-4 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          {group.name}
                          {group.frequency && (
                            <span className="ml-1 normal-case font-normal text-zinc-400 dark:text-zinc-500">
                              · {FREQ_LABEL[group.frequency] ?? group.frequency}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                    {group.periods.map(renderItem)}
                  </div>
                ))}
              </div>
            );
          })()}
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
              <div className="flex items-start gap-2">
                <PayPeriodDownload
                  payPeriodId={detail.payPeriod.id}
                  label={`${format(detail.payPeriod.startDate, "MMM d")} – ${format(detail.payPeriod.endDate, "MMM d, yyyy")}`}
                />
                {canRunPayroll && (
                  <PayPeriodActions
                    payPeriodId={detail.payPeriod.id}
                    status={detail.payPeriod.status}
                    unresolvedExceptions={detail.validation.unresolvedExceptions}
                    adpConfigured={adpConfigured}
                    payrollRun={payrollRun}
                  />
                )}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Open</p>
                <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
                  {detail.payPeriod.timesheets.length - lockedCount}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Locked</p>
                <p className="mt-1 text-2xl font-bold text-green-600">
                  {lockedCount}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Exceptions to Review</p>
                <p className={`mt-1 text-2xl font-bold ${
                  detail.validation.unresolvedExceptions > 0
                    ? "text-amber-600"
                    : "text-zinc-900 dark:text-white"
                }`}>
                  {detail.validation.unresolvedExceptions}
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
                siteId: ts.employee.siteId ?? null,
                siteName: ts.employee.site?.name ?? null,
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
