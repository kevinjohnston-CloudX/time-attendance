import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { getHoursReport } from "@/actions/admin.actions";
import { format } from "date-fns";
import { HoursReportTable, type ReportRow } from "@/components/reports/hours-report-table";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ payPeriodId?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "PAY_PERIOD_MANAGE")) redirect("/dashboard");

  const payPeriods = await db.payPeriod.findMany({
    orderBy: { startDate: "desc" },
  });

  const selectedId = sp.payPeriodId ?? payPeriods[0]?.id;

  const reportResult = selectedId ? await getHoursReport({ payPeriodId: selectedId }) : null;

  // Pre-compute rows for client component
  let rows: ReportRow[] = [];
  let periodLabel = "";

  if (reportResult?.success) {
    const { payPeriod, timesheets, ptoByEmployee } = reportResult.data;
    periodLabel = `${format(payPeriod.startDate, "MMM d")} – ${format(payPeriod.endDate, "MMM d, yyyy")}`;

    rows = timesheets.map((ts) => {
      const reg = ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
      const ot = ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0;
      const dt = ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0;
      const pto = ptoByEmployee[ts.employeeId] ?? 0;

      return {
        employeeId: ts.employeeId,
        name: ts.employee.user?.name ?? ts.employeeId,
        department: ts.employee.department.name,
        regMinutes: reg,
        otMinutes: ot,
        dtMinutes: dt,
        ptoMinutes: pto,
        totalMinutes: reg + ot + dt,
        status: ts.status,
      };
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Reports</h1>

      {/* Period selector */}
      <form method="GET" className="mt-4 flex items-center gap-3">
        <select
          name="payPeriodId"
          defaultValue={selectedId}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          {payPeriods.map((pp) => (
            <option key={pp.id} value={pp.id}>
              {format(pp.startDate, "MMM d")} – {format(pp.endDate, "MMM d, yyyy")} ({pp.status})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Load
        </button>
      </form>

      {reportResult?.success && (
        <HoursReportTable rows={rows} periodLabel={periodLabel} />
      )}
    </div>
  );
}
