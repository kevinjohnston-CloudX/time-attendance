import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getHolidayRules } from "@/actions/holiday-rule.actions";
import { CreateHolidayClient } from "./create-holiday-client";

export default async function NewHolidayPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const rulesResult = await getHolidayRules();
  const holidayRules = rulesResult.success ? rulesResult.data : [];

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/admin/site-settings?tab=holidays"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Holidays
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Holiday</h1>
      <CreateHolidayClient holidayRules={serialize(holidayRules)} />
    </div>
  );
}
