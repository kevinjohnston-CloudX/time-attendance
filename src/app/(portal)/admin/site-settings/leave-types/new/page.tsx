import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { CreateLeaveTypeClient } from "./create-leave-type-client";

export default async function NewLeaveTypePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const pcResult = await getAllPayCodes();
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=leave-types" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Leave Types
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Leave Type</h1>
      <CreateLeaveTypeClient payCodes={serialize(pcResult.success ? pcResult.data : [])} />
    </div>
  );
}
