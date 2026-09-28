import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getHolidayRules } from "@/actions/holiday-rule.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { EditHolidayRuleClient } from "./edit-holiday-rule-client";

export default async function EditHolidayRulePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasManage) redirect("/dashboard");
  const { id } = await params;
  const [rulesResult, payCodesResult] = await Promise.all([getHolidayRules(), getAllPayCodes()]);
  const rules = rulesResult.success ? rulesResult.data : [];
  const rule = rules.find((r) => r.id === id);
  if (!rule) redirect("/admin/rules-setup?tab=holiday-rules");
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/rules-setup?tab=holiday-rules" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">← Holiday Rules</Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{rule.name}</h1>
      <EditHolidayRuleClient
        rule={serialize(rule)}
        payCodes={serialize(payCodesResult.success ? payCodesResult.data : [])}
      />
    </div>
  );
}
