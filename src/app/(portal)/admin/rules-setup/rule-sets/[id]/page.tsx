import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getRuleSet } from "@/actions/admin.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { RuleSetEditor } from "@/components/admin/rule-set-editor";

/**
 * One rule set's editor. The rule set is read inside the caller's company,
 * so an id from another company, or one that does not exist, is a 404.
 */
export default async function RuleSetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "RULES_MANAGE"))) redirect("/dashboard");

  const { id } = await params;
  const [ruleSet, payCodes] = await Promise.all([getRuleSet({ ruleSetId: id }), getAllPayCodes()]);
  if (!ruleSet.success) notFound();

  // Dates and JSON columns cross to the client as plain values.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return <RuleSetEditor ruleSet={plain(ruleSet.data)} payCodes={plain(payCodes.success ? payCodes.data : [])} />;
}
