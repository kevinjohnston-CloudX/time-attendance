import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getLeaveTypes } from "@/actions/leave.actions";
import { db } from "@/lib/db";
import { RequestLeaveForm } from "@/components/leave/request-leave-form";

export default async function RequestLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "LEAVE_REQUEST_OWN")) redirect("/dashboard");

  const [result, employee] = await Promise.all([
    getLeaveTypes(),
    db.employee.findFirst({
      where: { userId: session.user.id },
      select: { shift: { select: { startTime: true, endTime: true, workDays: true } } },
    }),
  ]);

  if (!result.success || result.data.length === 0) redirect("/leave");

  return (
    <div className="max-w-xl">
      <Link
        href="/leave"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← My Leave
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        Request Leave
      </h1>
      <RequestLeaveForm leaveTypes={result.data} shift={employee?.shift ?? null} />
    </div>
  );
}
