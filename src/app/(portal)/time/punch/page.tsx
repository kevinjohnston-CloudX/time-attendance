import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PunchClock } from "@/components/time/punch-clock";
import { PunchHistoryTable } from "@/components/time/punch-history-table";
import { getCurrentPunchState } from "@/lib/utils/punch-helpers";

async function getTodayPunches(employeeId: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db.punch.findMany({
    where: { employeeId, isRejected: false, punchTime: { gte: start } },
    orderBy: { punchTime: "asc" },
  });
}

export default async function PunchPage() {
  const session = await auth();
  if (!session?.user?.employeeId) redirect("/dashboard");

  const { employeeId } = session.user;

  const [currentState, todayPunches] = await Promise.all([
    getCurrentPunchState(employeeId),
    getTodayPunches(employeeId),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
        Punch Clock
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Record your time in and out.
      </p>

      <div className="mt-6">
        <PunchClock initialState={currentState} />
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-white">
          Today&apos;s Punches
        </h2>
        <PunchHistoryTable punches={todayPunches} />
      </div>
    </div>
  );
}
