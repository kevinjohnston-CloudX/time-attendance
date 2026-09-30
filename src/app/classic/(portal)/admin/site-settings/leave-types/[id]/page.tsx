import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getLeaveTypesAdmin } from "@/actions/admin.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { EditLeaveTypeClient } from "./edit-leave-type-client";

export default async function EditLeaveTypePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const { id } = await params;
  const [ltResult, pcResult] = await Promise.all([getLeaveTypesAdmin(), getAllPayCodes()]);
  const leaveTypes = ltResult.success ? ltResult.data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaveType = leaveTypes.find((lt: any) => lt.id === id);
  if (!leaveType) redirect("/admin/site-settings?tab=leave-types");

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=leave-types" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Leave Types
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Edit Leave Type</h1>
      <EditLeaveTypeClient
        leaveType={serialize(leaveType)}
        payCodes={serialize(pcResult.success ? pcResult.data : [])}
      />
    </div>
  );
}
