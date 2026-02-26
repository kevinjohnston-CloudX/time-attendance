import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { getHoursReport } from "@/actions/admin.actions";
import { formatMinutes, minutesToHoursDecimal } from "@/lib/utils/duration";
import { format } from "date-fns";

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
        <>
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Hours Summary —{" "}
              {format(reportResult.data.payPeriod.startDate, "MMM d")} –{" "}
              {format(reportResult.data.payPeriod.endDate, "MMM d, yyyy")}
            </h2>
            <Link
              href={`/reports?payPeriodId=${selectedId}&export=1`}
              className="text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              Export CSV
            </Link>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Employee</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Department</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">REG</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">OT</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">DT</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Total</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
                {reportResult.data.timesheets.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-zinc-400">
                      No timesheets for this pay period.
                    </td>
                  </tr>
                )}
                {reportResult.data.timesheets.map((ts) => {
                  const reg = ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
                  const ot = ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0;
                  const dt = ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0;
                  const total = reg + ot + dt;

                  return (
                    <tr key={ts.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-white">
                        {ts.employee.user?.name ?? ts.employeeId}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {ts.employee.department.name}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {minutesToHoursDecimal(reg)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${ot > 0 ? "font-medium text-amber-600" : "text-zinc-400"}`}>
                        {minutesToHoursDecimal(ot)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${dt > 0 ? "font-medium text-red-600" : "text-zinc-400"}`}>
                        {minutesToHoursDecimal(dt)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">
                        {minutesToHoursDecimal(total)}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        {ts.status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals row */}
              {reportResult.data.timesheets.length > 0 && (() => {
                const totals = reportResult.data.timesheets.reduce(
                  (acc, ts) => {
                    acc.reg += ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
                    acc.ot += ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0;
                    acc.dt += ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0;
                    return acc;
                  },
                  { reg: 0, ot: 0, dt: 0 }
                );
                return (
                  <tfoot className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                        Totals ({reportResult.data.timesheets.length} employees)
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">
                        {minutesToHoursDecimal(totals.reg)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-600">
                        {minutesToHoursDecimal(totals.ot)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-600">
                        {minutesToHoursDecimal(totals.dt)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-zinc-900 dark:text-white">
                        {minutesToHoursDecimal(totals.reg + totals.ot + totals.dt)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
