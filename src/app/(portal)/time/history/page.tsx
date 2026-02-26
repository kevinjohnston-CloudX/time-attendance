import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PunchHistoryTable } from "@/components/time/punch-history-table";

export default async function PunchHistoryPage() {
  const session = await auth();
  if (!session?.user?.employeeId) redirect("/dashboard");

  const { employeeId } = session.user;

  // Find current pay period
  const now = new Date();
  const payPeriod = await db.payPeriod.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
  });

  const punches = payPeriod
    ? await db.punch.findMany({
        where: {
          employeeId,
          timesheet: { payPeriodId: payPeriod.id },
        },
        orderBy: { punchTime: "desc" },
      })
    : [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Punch History
          </h1>
          {payPeriod ? (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Pay period:{" "}
              {payPeriod.startDate.toLocaleDateString()} –{" "}
              {payPeriod.endDate.toLocaleDateString()}
            </p>
          ) : (
            <p className="mt-1 text-sm text-amber-500">No active pay period.</p>
          )}
        </div>
        <a
          href="/time/missed-punch"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Report Missed Punch
        </a>
      </div>

      <div className="mt-6">
        <PunchHistoryTable punches={punches} />
      </div>
    </div>
  );
}
