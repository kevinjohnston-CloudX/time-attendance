import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getLeaveTypes } from "@/actions/leave.actions";
import { RequestLeaveForm } from "@/components/leave/request-leave-form";

export default async function RequestLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "LEAVE_REQUEST_OWN")) redirect("/dashboard");

  const result = await getLeaveTypes();
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
      <RequestLeaveForm leaveTypes={result.data} />
    </div>
  );
}
