import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { RuleSetEditor } from "@/components/admin/rule-set-editor";

/** A new rule set, on the same page the existing ones are edited on. */
export default async function NewRuleSetPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "RULES_MANAGE"))) redirect("/dashboard");

  const payCodes = await getAllPayCodes();
  return <RuleSetEditor ruleSet={null} payCodes={JSON.parse(JSON.stringify(payCodes.success ? payCodes.data : []))} />;
}
