import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getHolidays } from "@/actions/holiday.actions";
import { getHolidayRules } from "@/actions/holiday-rule.actions";
import { EditHolidayClient } from "./edit-holiday-client";

export default async function EditHolidayPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const { id } = await params;
  const [holidaysResult, rulesResult] = await Promise.all([getHolidays(), getHolidayRules()]);
  const holidays = holidaysResult.success ? holidaysResult.data : [];
  const holiday = holidays.find((h: any) => h.id === id);
  if (!holiday) redirect("/admin/site-settings?tab=holidays");
  const holidayRules = rulesResult.success ? rulesResult.data : [];

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  // Remap observedDate → observedOn for the client component
  const holidayForClient = serialize({
    id: holiday.id,
    name: holiday.name,
    date: holiday.date,
    observedOn: holiday.observedDate ?? null,
    bypassAfterEligibility: holiday.bypassAfterEligibility,
    isActive: holiday.isActive,
    holidayRules: holiday.holidayRules ?? [],
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/admin/site-settings?tab=holidays"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Holidays
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Edit Holiday</h1>
      <EditHolidayClient holiday={holidayForClient} holidayRules={serialize(holidayRules)} />
    </div>
  );
}
