import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getHolidayRule } from "@/actions/holiday-rule.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { HolidayRuleEditor } from "@/components/admin/holiday-rule-editor";

/**
 * One holiday rule's editor. The rule is read inside the caller's company,
 * so an id from another company, or one that does not exist, is a 404.
 */
export default async function HolidayRulePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "RULES_MANAGE"))) redirect("/dashboard");

  const { id } = await params;
  const [rule, payCodes] = await Promise.all([getHolidayRule({ ruleId: id }), getAllPayCodes()]);
  if (!rule.success) notFound();

  // Dates, decimals and JSON columns cross to the client as plain values.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return <HolidayRuleEditor rule={plain(rule.data)} payCodes={plain(payCodes.success ? payCodes.data : [])} />;
}
