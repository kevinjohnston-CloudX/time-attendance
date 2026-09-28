import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { CreateHolidayRuleClient } from "./create-holiday-rule-client";

export default async function NewHolidayRulePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasManage) redirect("/dashboard");
  const payCodesResult = await getAllPayCodes();
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/rules-setup?tab=holiday-rules" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">← Holiday Rules</Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Holiday Rule</h1>
      <CreateHolidayRuleClient payCodes={serialize(payCodesResult.success ? payCodesResult.data : [])} />
    </div>
  );
}
