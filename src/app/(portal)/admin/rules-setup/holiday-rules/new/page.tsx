import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { HolidayRuleEditor } from "@/components/admin/holiday-rule-editor";

/** A new holiday rule, on the same page the existing ones are edited on. */
export default async function NewHolidayRulePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "RULES_MANAGE"))) redirect("/dashboard");

  const payCodes = await getAllPayCodes();
  return <HolidayRuleEditor rule={null} payCodes={JSON.parse(JSON.stringify(payCodes.success ? payCodes.data : []))} />;
}
